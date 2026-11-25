#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const routeFilePattern = /^lib\/routes\/.*\.tsx?$/;
const apiRouteFilePattern = /^lib\/routes\/.*\/api(?:\/.*)?\.tsx?$/;
const validMimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[^;=]+=[^;]+)*$/i;
const routeParamPattern = /:([A-Za-z0-9_]+)(?:\{[^}]+\})?[?*]?/g;
const sourceParamPattern = /:([A-Za-z0-9_]+)(?:\{[^}]+\})?[?*]?/g;
const routeParamSegmentPattern = /^:([A-Za-z0-9_]+)(?:\{([^}]+)\})?([?*])?$/;
const duplicateCommonQueryPattern =
    /\b(?:ctx\.req\.query|searchParams\.get)\s*\([^)]*['"`](?:limit|filter|filterout|filter_title|filter_description|filter_author|filter_category|filter_time|sorted|mode|opencc|format|scihub|image_hotlink_template|multimedia_hotlink_template|wrap_multimedia_in_iframe)['"`]/;
const sensitiveNamePattern = /\b(?:token|cookie|secret|password|passwd|api[_-]?key|access[_-]?key|refresh[_-]?token|csrf|session)\b/i;
const apiEndpointPattern = /(?:\/api\/|graphql|\.json(?:[?#]|$)|_next\/data|\/ajax\/|\/rest\/)/i;
const browserUsagePattern = /\b(puppeteer|browser|page\.|waitForSelector|waitForResponse|puppeteer-utils|playwright|getPlaywrightPage)\b/i;
const browserCreatePattern = /\b(puppeteer|playwright|getPlaywrightPage|getBrowser|newPage|browser\.newPage|page\.goto)\b/i;
const browserWaitPattern = /\b(waitForSelector|waitForResponse|waitUntil\s*:)\b/;
const browserInterceptionPattern = /\b(setRequestInterception|route\.|resourceType\s*\(|abort\s*\(|continue\s*\()\b/;
const closeCallPattern = /\b(?:page|browser)\.close\s*\(|\bdestroy\s*\(/g;
const awaitedClosePattern = /\bawait\s+(?:page|browser)\.close\s*\(|\bawait\s+destroy\s*\(/;
const hardcodedSecretPattern =
    /\b(?:Bearer\s+eyJ[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|csrf|session|cookie)\s*[:=]\s*['"`][A-Za-z0-9._~+/=-]{24,}['"`])/i;

const options = {
    metadata: true,
    types: true,
    static: true,
};

const rawFiles = [];
for (const arg of process.argv.slice(2)) {
    if (arg === '--types-only') {
        options.metadata = false;
        options.static = false;
    } else if (arg === '--static-only') {
        options.types = false;
        options.metadata = false;
    } else if (arg === '--no-metadata') {
        options.metadata = false;
    } else if (arg === '--no-types') {
        options.types = false;
    } else if (arg === '--no-static') {
        options.static = false;
    } else if (arg === '--help' || arg === '-h') {
        console.log(`Usage: route-audit.mjs [options] [lib/routes/<namespace>/<route>.ts ...]

Options:
  --types-only   Run project tsc and report diagnostics for target files.
  --static-only  Read source text only; do not import modules or run tsc.
  --no-metadata  Skip source module imports and metadata checks.
  --no-types     Skip TypeScript diagnostics.
  --no-static    Skip source heuristics.

No build is run. Metadata checks import the selected top-level route directories
through the current RSSHub registry helpers without calling handlers.
`);
        process.exit(0);
    } else if (arg.startsWith('--')) {
        console.error(`Unknown option: ${arg}`);
        process.exit(2);
    } else {
        rawFiles.push(arg);
    }
}

const counters = {
    pass: 0,
    warn: 0,
    fail: 0,
    note: 0,
};

const normalizePath = (value) => value.replaceAll(path.sep, '/').replace(/^\.\//, '');

const run = (command, args, runOptions = {}) =>
    spawnSync(command, args, {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
        ...runOptions,
    });

const report = (level, id, message, details = []) => {
    counters[level.toLowerCase()] += 1;
    console.log(`[${level}][${id}] ${message}`);
    for (const detail of details.filter(Boolean)) {
        console.log(`       ${detail}`);
    }
};

const pass = (id, message, details) => report('PASS', id, message, details);
const warn = (id, message, details) => report('WARN', id, message, details);
const fail = (id, message, details) => report('FAIL', id, message, details);
const note = (id, message, details) => report('NOTE', id, message, details);

const section = (name) => {
    console.log(`\n== ${name} ==`);
};

const isRssHubRoot = (directory) => fs.existsSync(path.join(directory, 'package.json')) && fs.existsSync(path.join(directory, 'lib/routes'));

const findRssHubRootAbove = (start) => {
    let current = start;
    for (;;) {
        if (isRssHubRoot(current)) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

const findRssHubRoot = () => {
    if (process.env.RSSHUB_ROOT) {
        const configuredRoot = path.resolve(process.env.RSSHUB_ROOT);
        return isRssHubRoot(configuredRoot) ? configuredRoot : null;
    }

    const cwdRoot = findRssHubRootAbove(process.cwd());
    if (cwdRoot) {
        return cwdRoot;
    }

    for (const file of rawFiles) {
        if (file.startsWith('--')) {
            continue;
        }

        const candidate = path.resolve(file);
        const start = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? path.dirname(candidate) : candidate;
        const fileRoot = findRssHubRootAbove(start);
        if (fileRoot) {
            return fileRoot;
        }
    }

    return null;
};

const rsshubRoot = findRssHubRoot();
if (!rsshubRoot) {
    console.error('Could not find RSSHub root. Run from the RSSHub repository root, a directory inside it, or set RSSHUB_ROOT.');
    process.exit(2);
}

const resolveExplicitFile = (file) => {
    const normalized = normalizePath(file);
    const candidates = [];

    if (path.isAbsolute(file)) {
        candidates.push(file);
    } else {
        candidates.push(path.resolve(file));
        candidates.push(path.resolve(rsshubRoot, file));
        if (normalized.startsWith('lib/routes/')) {
            candidates.unshift(path.resolve(rsshubRoot, file));
        }
    }

    const existing = candidates.find((candidate) => fs.existsSync(candidate));
    const resolved = existing ?? candidates[0];

    return normalizePath(path.relative(rsshubRoot, resolved));
};

const changedRouteFiles = () => {
    const tracked = run('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--', 'lib/routes'], {
        cwd: rsshubRoot,
    });
    const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', 'lib/routes'], {
        cwd: rsshubRoot,
    });

    return [...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')].map((file) => normalizePath(file.trim())).filter((file) => routeFilePattern.test(file));
};

const explicitFiles = rawFiles.map(resolveExplicitFile);
const missingExplicitFiles = explicitFiles.filter((file) => routeFilePattern.test(file) && !fs.existsSync(path.join(rsshubRoot, file)));
const targetFiles = [...new Set((explicitFiles.length > 0 ? explicitFiles : changedRouteFiles()).filter((file) => routeFilePattern.test(file) && !apiRouteFilePattern.test(file)))];

if (missingExplicitFiles.length > 0) {
    console.error(`Explicit route files do not exist under RSSHub root:\n${missingExplicitFiles.map((file) => `- ${file}`).join('\n')}`);
    process.exit(2);
}

if (targetFiles.length === 0) {
    if (rawFiles.length > 0) {
        console.error(
            `No valid route TypeScript files found in explicit arguments:\n${rawFiles.map((file) => `- ${file}`).join('\n')}\n\nPass paths relative to the RSSHub root, for example lib/routes/<namespace>/<file>.ts, or absolute paths.`
        );
        process.exit(2);
    }
    console.log('No route files to check. Pass lib/routes/<namespace>/<file>.ts or run with changed route files.');
    process.exit(0);
}

const targetSet = new Set(targetFiles);
const namespaceFromFile = (file) => file.split('/')[2];
const namespaceFileForRoute = (file) => {
    let directory = path.dirname(file);
    while (directory !== 'lib/routes' && directory !== '.') {
        const candidate = normalizePath(path.join(directory, 'namespace.ts'));
        if (fs.existsSync(path.join(rsshubRoot, candidate))) {
            return candidate;
        }
        directory = path.dirname(directory);
    }
    return `lib/routes/${namespaceFromFile(file)}/namespace.ts`;
};

section('Targets');
pass(
    'T1',
    'route files selected',
    targetFiles.map((file) => `- ${file}`)
);

const runTypes = () => {
    section('TypeScript');
    const tsc = run('pnpm', ['exec', 'tsc', '--noEmit', '--pretty', 'false'], { cwd: rsshubRoot });
    const output = `${tsc.stdout}${tsc.stderr}`;

    if (tsc.error) {
        fail('TS1', `failed to run pnpm exec tsc: ${tsc.error.message}`);
        return;
    }
    if (tsc.status !== 0 && output.trim().length === 0) {
        fail('TS1', 'pnpm exec tsc failed without diagnostic output. Ensure Corepack/pnpm dependencies are installed.');
        return;
    }

    const targetDiagnosticPatterns = targetFiles.map((file) => {
        const escaped = file.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[./\\\\])${escaped.replaceAll('/', String.raw`[/\\]`)}\\(`);
    });
    const diagnostics = output.split('\n').filter((line) => targetDiagnosticPatterns.some((pattern) => pattern.test(line)));

    if (diagnostics.length > 0) {
        fail('TS1', 'TypeScript diagnostics found for route files', diagnostics);
        return;
    }

    if (tsc.status !== 0 && !/error TS\d+:/.test(output)) {
        fail('TS1', 'tsc did not complete a diagnostic pass', output.trim().split('\n').slice(-15));
        return;
    }

    pass('TS1', 'no TypeScript diagnostics found for route files');
    if (tsc.status !== 0) {
        note('TS2', 'full-project tsc reported diagnostics outside target route files');
    }
};

const extractParams = (routePath) => {
    const params = new Set();
    for (const match of routePath.matchAll(routeParamPattern)) {
        params.add(match[1]);
    }
    return params;
};

const sortedArray = (values) => [...values].toSorted();

const extractRegistrableHost = (value) => {
    const host = value
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .split(':')[0]
        .toLowerCase();
    const parts = host.split('.').filter(Boolean);
    return parts.length <= 2 ? host : parts.slice(-2).join('.');
};

const escapeRegExp = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeTemplatePath = (value) => `/${value}`.replace(/\/+/g, '/');

const pathToPattern = (routePathValue, namespaceName = '') => {
    const full = normalizeTemplatePath(`${namespaceName ? `/${namespaceName}` : ''}${routePathValue}`);
    const segments = full.split('/').filter(Boolean);
    const pattern =
        segments
            .map((segment) => {
                const param = segment.match(routeParamSegmentPattern);
                if (!param) {
                    return `/${escapeRegExp(segment).replace(routeParamPattern, '[^/]+')}`;
                }

                const [, , customPattern, modifier] = param;
                if (modifier === '?') {
                    return '(?:/[^/]+)?';
                }
                if (modifier === '*' || customPattern === '.+') {
                    return '/.+';
                }

                return '/[^/]+';
            })
            .join('') || '/';

    return new RegExp(`^${pattern}$`);
};

const targetTemplateToSamplePath = (target) => {
    const segments = normalizeTemplatePath(target)
        .split('/')
        .filter(Boolean)
        .map((segment) => {
            const param = segment.match(routeParamSegmentPattern);
            if (!param) {
                return segment;
            }

            const [, , customPattern, modifier] = param;
            return modifier === '*' || customPattern === '.+' ? 'sample/path' : 'sample';
        });

    return `/${segments.join('/')}`;
};

const targetMatchesRoutePath = (target, routePathValue) => routePathValue === target || pathToPattern(routePathValue).test(targetTemplateToSamplePath(target));

const diffSets = (left, right) => ({
    onlyLeft: sortedArray([...left].filter((value) => !right.has(value))),
    onlyRight: sortedArray([...right].filter((value) => !left.has(value))),
});

const findMetadataRoutes = (namespaces) => {
    const found = new Map();
    for (const [namespaceName, namespaceData] of Object.entries(namespaces ?? {})) {
        for (const [routePathKey, routeData] of Object.entries(namespaceData.routes ?? {})) {
            const file = `lib/routes/${namespaceName}/${routeData.location}`;
            if (targetSet.has(file)) {
                if (!found.has(file)) {
                    found.set(file, []);
                }
                found.get(file).push({
                    namespaceName,
                    namespaceData,
                    routePathKey,
                    routeData,
                });
            }
        }
    }
    return found;
};

const checkMetadataRoute = (file, entries) => {
    const first = entries[0];
    const { namespaceData, routeData } = first;
    const label = `${file}`;
    const paths = entries.map((entry) => entry.routePathKey);

    if (!routeData.example?.startsWith('/')) {
        fail('M1', `${label}: example must start with /`, [`example: ${routeData.example}`]);
    } else if (/^https?:\/\//i.test(routeData.example)) {
        fail('M1', `${label}: example must be an RSSHub path, not a URL`, [`example: ${routeData.example}`]);
    } else if (/[:*{}]/.test(routeData.example)) {
        fail('M1', `${label}: example must be concrete, not a path template`, [`example: ${routeData.example}`]);
    } else if (!paths.some((routePathValue) => pathToPattern(routePathValue, first.namespaceName).test(routeData.example))) {
        warn('M1', `${label}: example may not match namespace + route path`, [`example: ${routeData.example}`, `route paths: ${paths.join(', ')}`]);
    } else {
        pass('M1', `${label}: example format is valid`);
    }

    if (namespaceData.url && /^https?:\/\//i.test(namespaceData.url)) {
        fail('M2', `${label}: namespace.url must not include protocol`, [`namespace.url: ${namespaceData.url}`]);
    }
    if (routeData.url && /^https?:\/\//i.test(routeData.url)) {
        fail('M3', `${label}: route.url must not include protocol`, [`route.url: ${routeData.url}`]);
    }
    if (routeData.url && apiEndpointPattern.test(routeData.url)) {
        warn('M3', `${label}: route.url looks like an API endpoint; use a human-readable page URL`, [`route.url: ${routeData.url}`]);
    }

    if (routeData.name && namespaceData.name && routeData.name === namespaceData.name) {
        fail('M4', `${label}: route name must not repeat namespace name`, [`name: ${routeData.name}`]);
    }

    const categories = routeData.categories ?? namespaceData.categories;
    if (categories && categories.length > 1) {
        fail('M5', `${label}: categories must contain only one category`, [`categories: ${categories.join(', ')}`]);
    }

    if (!Array.isArray(routeData.maintainers) || routeData.maintainers.length === 0) {
        fail('M6', `${label}: maintainers must be a non-empty array`);
    } else {
        const invalidMaintainers = routeData.maintainers.filter((maintainer) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(maintainer));
        if (invalidMaintainers.length > 0) {
            fail('M6', `${label}: maintainers must be valid GitHub username syntax`, invalidMaintainers);
        } else {
            pass('M6', `${label}: maintainer username syntax is valid`);
            note('M7', `${label}: syntax does not prove GitHub account existence; follow the repository maintainer convention`);
        }
    }

    const parameterKeys = new Set(Object.keys(routeData.parameters ?? {}));
    const pathParams = new Set(paths.flatMap((routePathValue) => [...extractParams(routePathValue)]));
    const paramDiff = diffSets(parameterKeys, pathParams);
    if (paramDiff.onlyLeft.length > 0 || paramDiff.onlyRight.length > 0) {
        fail('M8', `${label}: route parameters must match path params`, [
            paramDiff.onlyLeft.length ? `parameters without path params: ${paramDiff.onlyLeft.join(', ')}` : '',
            paramDiff.onlyRight.length ? `path params without parameters: ${paramDiff.onlyRight.join(', ')}` : '',
        ]);
    } else {
        pass('M8', `${label}: route parameters match path params`);
    }

    const radarItems = routeData.radar ?? [];
    for (const [index, item] of radarItems.entries()) {
        const sources = item.source ?? [];
        if (sources.length === 0) {
            warn('R1', `${label}: radar source is empty`, [`radar[${index}]`]);
        }
        const protocolSources = sources.filter((source) => /^https?:\/\//i.test(source));
        if (protocolSources.length > 0) {
            fail('R1', `${label}: radar source must not include protocol`, protocolSources);
        }
        const domains = new Set(sources.map(extractRegistrableHost).filter(Boolean));
        if (domains.size > 1) {
            warn('R1', `${label}: radar item mixes multiple registrable domains`, [...domains]);
        }

        if (item.target) {
            const target = item.target;
            if (typeof target !== 'string') {
                warn('R2', `${label}: radar target is not a static string; prefer static targets for new routes`, [`radar[${index}].target type: ${typeof target}`]);
                continue;
            }
            if (target.startsWith(`/${first.namespaceName}/`)) {
                warn('R2', `${label}: radar target should not include namespace`, [`radar[${index}].target: ${target}`]);
            }
            const targetParams = extractParams(target);
            const sourceParams = new Set(sources.flatMap((source) => [...source.matchAll(sourceParamPattern)].map((match) => match[1])));
            const missingSourceParams = sortedArray([...targetParams].filter((param) => !sourceParams.has(param)));
            const targetMatchesRoute = paths.some((routePathValue) => targetMatchesRoutePath(target, routePathValue));
            if (!targetMatchesRoute) {
                warn('R2', `${label}: radar target may not match route path`, [`radar[${index}].target: ${target}`, `route paths: ${paths.join(', ')}`]);
            }
            if (missingSourceParams.length > 0) {
                warn('R3', `${label}: radar target contains params not present in source`, missingSourceParams);
            }
        }
    }

    if (radarItems.length > 0 && routeData.features?.supportRadar === false) {
        warn('F1', `${label}: radar exists but supportRadar is false`);
    }
    if (radarItems.length === 0 && routeData.features?.supportRadar === true) {
        warn('F1', `${label}: supportRadar is true but no radar rules were found`);
    }
    if (routeData.features?.requireConfig === true) {
        fail('F4', `${label}: requireConfig must be false or a config item array, not true`);
    }
    if (Array.isArray(routeData.features?.requireConfig)) {
        for (const [index, item] of routeData.features.requireConfig.entries()) {
            if (!item?.name || !item?.description) {
                fail('F4', `${label}: requireConfig item must include name and description`, [`requireConfig[${index}]`]);
            }
        }
    }
    if (routeData.categories?.includes('popular') || namespaceData.categories?.includes('popular')) {
        warn('M5', `${label}: avoid broad manual categories such as popular`);
    }

    const source = fs.readFileSync(path.join(rsshubRoot, file), 'utf8');
    const usesBrowser = browserUsagePattern.test(source);
    if (routeData.features?.requirePuppeteer === true && !usesBrowser) {
        warn('F2', `${label}: requirePuppeteer is true but browser usage was not detected`);
    }
    if (routeData.features?.requirePuppeteer !== true && usesBrowser) {
        warn('F3', `${label}: browser usage detected but requirePuppeteer is not true`);
    }
    if (routeData.features?.supportBT === true && !/application\/x-bittorrent|magnet:/i.test(source)) {
        warn('F5', `${label}: supportBT is true but no BT enclosure or magnet pattern was detected`);
    }
    if (routeData.features?.supportPodcast === true && !/itunes_|enclosure_/i.test(source)) {
        warn('F6', `${label}: supportPodcast is true but podcast/enclosure fields were not detected`);
    }
};

const runSourceMetadata = () => {
    section('Source Metadata');
    let loader;
    try {
        loader = pathToFileURL(createRequire(path.join(rsshubRoot, 'package.json')).resolve('tsx')).href;
    } catch (error) {
        fail('M0', `tsx must be installed in the target RSSHub tree: ${error.message}`);
        return null;
    }
    const importUrl = (relative) => pathToFileURL(path.join(rsshubRoot, relative)).href;
    const directories = [...new Set(targetFiles.map(namespaceFromFile))];
    const marker = 'RSSHUB_ROUTE_AUDIT:';
    const script = `(async () => {
        const { directoryImport } = await import(${JSON.stringify(importUrl('lib/utils/directory-import.ts'))});
        const { applyModulesToNamespaces, collectNamespaceRoots, resolveModuleNamespace } = await import(${JSON.stringify(importUrl('lib/registry-helpers.ts'))});
        const modules = {};
        for (const name of ${JSON.stringify(directories)}) {
            const found = await directoryImport({ targetDirectoryPath: process.cwd() + '/lib/routes/' + name, importPattern: /\\.tsx?$/ });
            for (const [file, content] of Object.entries(found)) modules['/' + name + file] = content;
        }
        const roots = collectNamespaceRoots(Object.keys(modules));
        const seen = new Map();
        const duplicates = [];
        const routeFiles = [];
        for (const [file, content] of Object.entries(modules)) {
            const { namespace } = resolveModuleNamespace(file, roots);
            if (content.route) routeFiles.push('lib/routes' + file);
            for (const kind of ['route', 'apiRoute']) {
                const definition = content[kind];
                if (!definition) continue;
                for (const suffix of [definition.path].flat()) {
                    const key = kind + ':/' + namespace + suffix.replace(/:[A-Za-z0-9_]+/g, ':param');
                    const previous = seen.get(key);
                    if (previous && previous !== file) duplicates.push({ key, files: [previous, file] });
                    seen.set(key, file);
                }
            }
        }
        const namespaces = {};
        applyModulesToNamespaces(modules, namespaces);
        console.log(${JSON.stringify(marker)} + JSON.stringify({ namespaces, duplicates, routeFiles }, (_, value) => typeof value === 'function' ? { auditFunction: true } : value));
    })().catch((error) => { console.error(error); process.exitCode = 1; });`;
    const imported = run(process.execPath, ['--import', loader, '--input-type=module', '--eval', script], {
        cwd: rsshubRoot,
        env: { ...process.env, NODE_ENV: 'dev', CACHE_TYPE: 'memory', REDIS_URL: '', REMOTE_CONFIG: '' },
    });
    if (imported.error || imported.status !== 0) {
        fail('M0', 'could not load route metadata from source', [imported.error?.message, ...`${imported.stdout}${imported.stderr}`.trim().split('\n').slice(-20)]);
        return null;
    }

    let metadata;
    try {
        const output = imported.stdout.split('\n').find((line) => line.startsWith(marker));
        metadata = JSON.parse(output?.slice(marker.length) ?? '');
    } catch (error) {
        fail('M0', `could not read source metadata: ${error.message}`);
        return null;
    }
    for (const duplicate of metadata.duplicates) {
        fail('M0', `duplicate route pattern before registry overwrite: ${duplicate.key}`, duplicate.files);
    }
    const found = findMetadataRoutes(metadata.namespaces);
    for (const file of targetFiles) {
        const entries = found.get(file);
        if (!entries?.length) {
            if (metadata.routeFiles.includes(file)) {
                fail('M0', `${file}: route export was overwritten or could not be registered`);
            } else {
                note('M0', `${file}: helper or namespace module; no route metadata to check`);
            }
            continue;
        }
        checkMetadataRoute(file, entries);
    }

    return found;
};

const lineNumberOf = (source, index) => source.slice(0, index).split('\n').length;

const findObjectKeys = (source) => {
    const matches = [];
    const propertyPattern = /(?:^|[,{(]\s*)([A-Za-z_$][\w$]*)\s*:/gm;
    for (const match of source.matchAll(propertyPattern)) {
        matches.push({
            key: match[1],
            line: lineNumberOf(source, match.index ?? 0),
        });
    }
    return matches;
};

const hasCachedDetailLoadPattern = (source) =>
    /\bcache\.tryGet\s*\([\s\S]{0,1500}\b\w*Detail\w*\s*\(/i.test(source) && /\b(?:async\s+function\s+\w*Detail\w*|function\s+\w*Detail\w*|const\s+\w*Detail\w*\s*=\s*async)[\s\S]{0,3000}\bload\s*\(/i.test(source);

const runStaticChecks = () => {
    section('Source Heuristics');
    for (const file of targetFiles) {
        const absoluteFile = path.join(rsshubRoot, file);
        const source = fs.readFileSync(absoluteFile, 'utf8');
        const namespaceFile = namespaceFileForRoute(file);

        if (!fs.existsSync(path.join(rsshubRoot, namespaceFile))) {
            warn('S1', `${file}: namespace.ts was not found`, [namespaceFile]);
        }
        const legacyFiles = ['router.ts', 'maintainer.ts', 'radar.ts'].map((name) => `lib/routes/${namespaceFromFile(file)}/${name}`).filter((candidate) => fs.existsSync(path.join(rsshubRoot, candidate)));
        if (legacyFiles.length > 0) {
            fail('S2', `${file}: legacy route files are present`, legacyFiles);
        }

        if (/\bnew Date\s*\(\s*\)/.test(source) && /\bpubDate\b/.test(source)) {
            warn('S3', `${file}: new Date() appears near route code; do not use current time as pubDate fallback`);
        }
        if (/\ballowEmpty\s*:\s*true/.test(source)) {
            warn('S4', `${file}: allowEmpty requires explicit justification`);
        }
        if (/item\s*:\s*\[\s*\]/.test(source)) {
            warn('S5', `${file}: empty item array detected; do not bypass broken-feed checks`);
        }
        if ((source.match(/\bload\s*\(/g) ?? []).length > 1) {
            if (hasCachedDetailLoadPattern(source)) {
                note('S6', `${file}: cheerio load() appears multiple times in a cached detail parser pattern`);
            } else {
                warn('S6', `${file}: cheerio load() appears multiple times`);
            }
        }
        if (/\bofetch\b/.test(source) && /\bJSON\.parse\s*\(/.test(source)) {
            warn('S7', `${file}: JSON.parse appears with ofetch; ofetch usually parses JSON automatically`);
        }
        if (/\bsetTimeout\s*\(|\bsleep\s*\(|waitForTimeout\s*\(/.test(source)) {
            warn('S8', `${file}: fixed delay detected; prefer selector or response waits`);
        }
        if (/Promise\.all[\s\S]{0,300}\b(browser|puppeteer|newPage|page)\b/i.test(source)) {
            warn('S9', `${file}: browser usage inside Promise.all may create multiple sessions`);
        }
        if (browserCreatePattern.test(source) && !browserInterceptionPattern.test(source)) {
            warn('S9', `${file}: browser usage detected without request interception/resource filtering`);
        }
        if (browserCreatePattern.test(source) && !browserWaitPattern.test(source)) {
            warn('S9', `${file}: browser usage detected without selector/response/navigation wait condition`);
        }
        if (browserCreatePattern.test(source) && closeCallPattern.test(source) && !awaitedClosePattern.test(source)) {
            warn('S9', `${file}: browser/page close or destroy call may not be awaited`);
        }
        if (/\bcache\.tryGet\b/.test(source)) {
            pass('S10', `${file}: cache.tryGet usage detected`);
        } else if (/Promise\.all\s*\([^)]*\.map|\.map\s*\(\s*async|description\s*=|fulltext|content_html/i.test(source)) {
            warn('S10', `${file}: detail/fulltext pattern may need cache.tryGet`);
        }
        if (/\bcache\.(?:tryGet|set|get)\s*\(\s*['"`][^'"`:]+['"`]/.test(source)) {
            warn('S10', `${file}: cache key literal should use colon-separated namespace/kind/id form`);
        }
        if (/\bcache\.(?:tryGet|set)\s*\([^)]*(?:token|cookie|csrf|session)/is.test(source) && !/\bcache\.(?:tryGet|set)\s*\([^)]*,[^)]*,\s*[^,)]+/.test(source)) {
            warn('S10', `${file}: possible credential material in a content-cache key; use the project config/secret mechanism`);
        }
        if (/<\w+[^>]*\sreferrerpolicy\s*=|referrerPolicy\s*:|\.attr\s*\(\s*['"]referrerpolicy['"]\s*,/i.test(source)) {
            warn('S11', `${file}: route-local referrer policy detected`);
        }
        if (/\bprocess\.env\b/.test(source)) {
            warn('S16', `${file}: route reads process.env directly; prefer centralized config`);
        }
        if (hardcodedSecretPattern.test(source)) {
            warn('S16', `${file}: possible hardcoded secret/token/cookie detected`);
        }
        if (duplicateCommonQueryPattern.test(source)) {
            warn('S17', `${file}: route appears to reimplement RSSHub common query parameters`);
        }
        if (sensitiveNamePattern.test(source) && /path\s*:|parameters\s*:|example\s*:|radar\s*:/.test(source)) {
            warn('S18', `${file}: sensitive names appear near route contract; do not put secrets in path/example/parameters/radar`);
        }
        if (/\bConfigNotFoundError\b/.test(source) && /requireConfig\s*:\s*false/.test(source)) {
            warn('S19', `${file}: ConfigNotFoundError appears while requireConfig is false`);
        }
        if (/requireConfig\s*:\s*\[/.test(source) && !/\bConfigNotFoundError\b/.test(source)) {
            warn('S19', `${file}: requireConfig array exists but ConfigNotFoundError was not detected`);
        }
        if (/(__NEXT_DATA__|_next\/data|buildId)/.test(source) && /buildId\s*[:=]\s*['"`][A-Za-z0-9_-]{6,}['"`]/.test(source)) {
            warn('S20', `${file}: hardcoded Next/Nuxt build id detected`);
        }
        if (/(graphql|operationName|variables|query\s*:)/i.test(source) && /(?:sha256Hash|persisted|queryId)\s*[:=]\s*['"`][A-Za-z0-9_-]{16,}['"`]/i.test(source) && !/\bcache\.|buildId|manifest|dynamic/i.test(source)) {
            warn('S21', `${file}: hardcoded GraphQL persisted hash/query id may need dynamic discovery`);
        }
        if (/(captcha|waf|acw_sc|_waftoken|环境异常)/i.test(source) && !/antiCrawler\s*:\s*true|throw new/i.test(source)) {
            warn('S22', `${file}: anti-crawler markers detected without feature flag or explicit error path`);
        }
        if (/\bconsole\.(?:log|debug|info)\s*\(|\bdebugger\b/.test(source)) {
            warn('S23', `${file}: debug output detected`);
        }

        for (const match of source.matchAll(/enclosure_type\s*:\s*['"`]([^'"`]+)['"`]/g)) {
            if (!validMimePattern.test(match[1])) {
                fail('S12', `${file}: enclosure_type must be a valid MIME type`, [`line ${lineNumberOf(source, match.index ?? 0)}: ${match[1]}`]);
            }
        }
        for (const match of source.matchAll(/enclosure_url\s*:\s*['"`]([^'"`]+)['"`]/g)) {
            if (/^https?:\/\//i.test(match[1]) && !/\.(?:mp3|m4a|mp4|m4v|mov|webm|ogg|oga|wav|flac|aac|avi|mkv)(?:[?#]|$)/i.test(match[1])) {
                warn('S13', `${file}: enclosure_url may not point to a direct media file`, [`line ${lineNumberOf(source, match.index ?? 0)}: ${match[1]}`]);
            }
        }
        if (/application\/x-bittorrent|magnet:/i.test(source) && !/supportBT\s*:\s*true/.test(source)) {
            warn('S13', `${file}: BT/magnet output detected but supportBT is not true`);
        }
        if (/\bitunes_(?:author|category|explicit|item_image|duration)\s*:/.test(source) && !/supportPodcast\s*:\s*true/.test(source)) {
            warn('S13', `${file}: podcast fields detected but supportPodcast is not true`);
        }
        if (/\bmedia\s*:\s*\{/.test(source) && !/(url|thumbnail|type)\s*:/.test(source)) {
            warn('S13', `${file}: media object detected without obvious url/thumbnail/type fields`);
        }
        if (/raw\s*\(/.test(source) && !/(remove\s*\(|unwrap\s*\(|sanitize|clean|content|article|description)/i.test(source)) {
            warn('S24', `${file}: TSX raw() detected without obvious content-cleaning logic`);
        }
        if (/<script\b|on(?:load|error|click|mouseover)\s*=/.test(source)) {
            warn('S24', `${file}: description HTML may contain script or event attributes`);
        }
        if (/\b(?:href|src|poster)\s*:\s*[^,\n]*(?:\+|`[^`]*\$\{)/.test(source) && !/\bnew URL\s*\(/.test(source)) {
            warn('S24', `${file}: URL construction detected without new URL() normalization`);
        }
        if (/(?:link|url)\s*:\s*['"`][^'"`]*(?:\/api\/|\.json|graphql|_next\/data)/i.test(source)) {
            warn('S25', `${file}: Data.link or item link may point to an API/JSON endpoint`);
        }
        if (/(?:pubDate|updated)\s*:\s*(?:Date\.now\s*\(\s*\)|new Date\s*\(\s*\))/i.test(source)) {
            warn('S26', `${file}: pubDate/updated appears to use current time`);
        }
        if (/\bupdated\s*:\s*pubDate\b|\bupdated\s*:\s*item\.pubDate\b/.test(source)) {
            warn('S26', `${file}: updated appears to copy pubDate; verify source has a real updated time`);
        }
        if (/(?:guid|id)\s*:\s*(?:Date\.now\s*\(\s*\)|Math\.random\s*\(\s*\)|title\b|item\.title\b|['"`]\s*['"`])/.test(source)) {
            warn('S27', `${file}: guid/id may be unstable`);
        }
        if (/\b(?:enclosure_length)\s*:\s*['"`]/.test(source)) {
            warn('S28', `${file}: enclosure_length should be a number of bytes, not a string`);
        }
        if (/:\s*null\b/.test(source)) {
            warn('S29', `${file}: explicit null detected; omit absent fields instead`);
        }

        const suspiciousKeys = findObjectKeys(source).filter(({ key }) => key === 'bio' || /^(video_url|image_url|pub_date)$/.test(key));
        if (suspiciousKeys.length > 0) {
            warn(
                'S14',
                `${file}: suspicious object keys detected; DataItem only supports known properties`,
                suspiciousKeys.map(({ key, line }) => `line ${line}: ${key}`)
            );
        }

        note('S15', `${file}: source availability and feed quality need task-appropriate instance evidence; text heuristics cannot establish either`);
    }
};

if (options.types) {
    runTypes();
}

if (options.metadata) {
    runSourceMetadata();
}

if (options.static) {
    runStaticChecks();
}

section('Summary');
console.log(`PASS=${counters.pass} WARN=${counters.warn} FAIL=${counters.fail} NOTE=${counters.note}`);

if (counters.fail > 0) {
    process.exit(1);
}

process.exit(0);
