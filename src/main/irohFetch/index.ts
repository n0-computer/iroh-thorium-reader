import { app } from 'electron';
import { mkdirSync } from "fs";
import * as debug_ from "debug";
import fetch, { Response, ResponseInit } from "node-fetch";
import { AuthorId, BlobDownloadOptions, Doc, DownloadPolicy, Iroh, LiveEvent, Query, SetTagOption } from "@number0/iroh";

import { metrics } from "./metrics";

export { pushGateway, metrics } from "./metrics";

const debug = debug_("readium-desktop:main#irohFetch");

const PROVIDER_SEPARATOR: string = ":::";
const HEADER_PREFIX: string = "http_headers";

export interface IrohFetchOptions {
    provide: boolean;
}

const defaultOptions: IrohFetchOptions = {
    provide: true,
}

export class IrohFetch {
    private options: IrohFetchOptions;
    private node: Iroh;
    private doc: Doc;
    private nodeId: string;
    private author: AuthorId;

    constructor(docTicket: string, options: IrohFetchOptions = defaultOptions) {
        this.options = options;
        debug("irohFetch initializing", docTicket);
        (async () => {
            let irohDataDir = app.getPath("appData") + "/iroh";
            mkdirSync(irohDataDir, { recursive: true });
            this.node = await Iroh.persistent(irohDataDir);
            this.doc = await this.node.docs.join(docTicket);
            debug("irohFetch joined doc", this.doc.id());
            this.author = await this.node.authors.default();
            this.nodeId = await this.node.node.nodeId();
            await this.doc.setDownloadPolicy(DownloadPolicy.nothing());
            await this.doc.subscribe(this.handleDocumentEvent);
            debug("irohFetch initialized", this.nodeId);
        })();
    }

    public async fetch(url: string): Promise<Response> {
        debug("fetching", url, this);
        // check the document for providers of this URL
        let res = await this.fetchIroh(url);
        if (res !== null) {
            debug("returning response fetched from iroh", url);
            return res;
        }

        debug("url doesn't exist in iroh, fetching from web")
        // couldn't fetch via iroh, fall back to regular fetch
        metrics.httpRequestCount.inc(1);
        res = await fetch(url)

        if (res?.ok && this.options.provide) {
            debug("fetched from web, adding to iroh", url);
            // TODO - add to iroh, list in document
            // serialize headers, add to iroh
            const headerBuffer = IrohFetch.encodeHeader(res);
            const headerKey = Buffer.from(`${HEADER_PREFIX}${PROVIDER_SEPARATOR}${url}`, "utf-8");
            await this.doc.setBytes(this.author, Array.from(headerKey), Array.from(headerBuffer));

            // encode body to bytes, add to iroh
            let body = Buffer.from(await res.arrayBuffer())
            await this.doc.setBytes(
                this.author,
                Array.from(Buffer.from(`${url}${PROVIDER_SEPARATOR}${this.nodeId}`, "utf-8")),
                Array.from(body),
            );
            metrics.httpBytesFetched.inc(body.length);

            let header = IrohFetch.decodeHeader(headerBuffer);
            return new Response(body, header);
        }

        debug("fetched from web, not adding to iroh", res.ok, url);
        return res
    }

    private static encodeHeader(res: Response): Buffer {
        const headers: Record<string, string[]> = {};
        res.headers.forEach((value, name) => {
            if (headers[name]) {
                headers[name].push(value);
            } else {
                headers[name] = [value];
            }
        });

        const header = {
            url: res.url,
            type: res.type,
            redirected: res.redirected,
            status: res.status,
            statusText: res.statusText,
            headers,
        }
        return Buffer.from(JSON.stringify(header), "utf-8");
    }

    private static decodeHeader(buffer: Buffer): ResponseInit {
        return JSON.parse(buffer.toString("utf-8"));
    }

    // Recreate a Response object from a header buffer and a body buffer stored in iroh
    private async fetchIroh(url: string): Promise<Response | null> {
        debug("fetching from iroh", url);
        const res = await this.providers(url);
        if (res === null) {
            return null;
        }

        const [headerHash, bodyHash, provs] = res;
        debug(`found ${provs.length} providers for ${url}`);
        const headerData = await this.getHashBuffer(headerHash, provs);
        const header = IrohFetch.decodeHeader(headerData);
        const body = await this.getHashBuffer(bodyHash, provs);
        metrics.irohBytesFetched.inc(body.length);;
        return new Response(body, header);
    }

    private async getHashBuffer(hash: string, providers: string[]): Promise<Buffer> {
        await this.getHash(hash, providers);
        const array = await this.node.blobs.readToBytes(hash)
        return Buffer.from(array);
    }

    // private async getHashFilepath(hash: string, providers: string[]): Promise<string> {
    //     await this.getHash(hash, providers);

    //     const destination = `/tmp/${hash}`;
    //     try {
    //         debug("exporting", hash, destination)
    //         await this.node.blobs.export(hash, destination, "Blob", "TryReference")
    //     } catch (e) {
    //         debug(`error exporting: ${e}`)
    //     }
    //     return destination;
    // }

    private async getHash(hash: string, providers: string[]): Promise<void> {
        debug("downloading", hash, providers.length);
        // TODO: handle multiple providers
        const downloadOptions = new BlobDownloadOptions("Raw", { nodeId: providers[0] }, SetTagOption.auto());
        metrics.irohRequestCount.inc(1);
        return await this.node.blobs.download(hash, downloadOptions, async (err, progress) => {
            if (err) {
                debug("download error", err);
                return;
            }
            debug("download progress", progress);
        });
    }

    private async providers(url: string): Promise<any[] | null> {
        // check headers for hash presence
        debug("checking providers for", url);
        let headerKey = Buffer.from(`${HEADER_PREFIX}${PROVIDER_SEPARATOR}${url}`, "utf-8");
        let query = Query.keyPrefix(Array.from(headerKey));
        let headerEntry = await this.doc.getOne(query);
        if (headerEntry === null) {
            return null;
        }

        const buffer = Buffer.from(url, "utf-8");
        query = Query.keyPrefix(Array.from(buffer));
        let entries = await this.doc.getMany(query)
        let hash = "";
        const providers = entries.map((entry) => {
            hash = entry.hash;
            const keyComponents = Buffer.from(entry.key).toString("utf-8").split(PROVIDER_SEPARATOR)
            if (keyComponents.length !== 2) {
                return "";
            }
            return keyComponents[1];
        }).filter((entry) => entry !== "");

        return [headerEntry.hash, hash, providers];
    }

    private handleDocumentEvent(err: Error, arg: LiveEvent) {
        if (err) {
            debug("document error", err);
            return;
        }
        debug("document event", arg);
    }
}

// a demo ticket for testing, hosted on iroh.network
const DEMO_DOC_TICKET = "docaaacbyheqs6iy4mn7lehp5yg3v3zfk2iylmwzr2gwgfh5m7akhwbnjt6afk62aofuwwwu5zb5ocvzj5v3rtqt6siglyuhoxhqtu4fxravvoteaaa";

// a shared instance of IrohFetch for use in the app, in the real world this should be
// created on app startup and shared throughout the app
export const sharedIrohFetch = new IrohFetch(DEMO_DOC_TICKET);
