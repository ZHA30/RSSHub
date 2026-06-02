import { raw } from 'hono/html';
import { renderToString } from 'hono/jsx/dom/server';

type DescriptionProps = {
    embed: boolean;
    ugc?: boolean;
    ogv?: boolean;
    aid?: string | number;
    cid?: string | number;
    bvid?: string | number;
    seasonId?: string | number;
    episodeId?: string | number;
    img?: string;
    description?: string;
};

const createPlayerUrl = (baseUrl: string, params: Record<string, string | number | undefined | null>) => {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
        if (value) {
            url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
};

const Description = ({ embed, ugc, ogv, aid, cid, bvid, seasonId, episodeId, img, description }: DescriptionProps) => (
    <>
        {embed ? (
            <>
                {ugc && (aid || cid || bvid) ? (
                    <iframe
                        width="640"
                        height="360"
                        src={createPlayerUrl('https://player.bilibili.com/player.html', { isOutside: 'true', aid, bvid, cid, p: '1' })}
                        scrolling="no"
                        border="0"
                        frameborder="no"
                        framespacing="0"
                        allowfullscreen
                    ></iframe>
                ) : null}
                {ogv ? <iframe width="640" height="360" src={`https://www.bilibili.com/blackboard/html5mobileplayer.html?seasonId=${seasonId}&episodeId=${episodeId}`} frameborder="0" allowfullscreen></iframe> : null}
                <br />
            </>
        ) : null}
        {img ? (
            <>
                <img src={img} />
                <br />
            </>
        ) : null}
        {description ? raw(description) : null}
    </>
);

export const renderDescription = (props: DescriptionProps): string => renderToString(<Description {...props} />);
