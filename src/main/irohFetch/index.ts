import { app } from 'electron';
import { mkdirSync } from "fs";
import * as debug_ from "debug";
import fetch, { Response, ResponseInit } from "node-fetch";
import { AddrInfoOptions, AuthorId, BlobDownloadOptions, BlobFormat, BlobProvideEvent, Doc, DocTicket, DownloadPolicy, DownloadProgress, Iroh, LiveEvent, Query, SetTagOption, ShareMode } from "@number0/iroh";
import base32Encode from 'base32-encode'

import { metrics, postDeviceDetails, postProvide, postRequestData } from "./metrics";

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
    private ticket: DocTicket;
    private spawned: boolean = false;

    private options: IrohFetchOptions;
    private node: Iroh;
    private doc: Doc;
    private nodeId: string;
    private author: AuthorId;

    private provides: Map<string, string> = new Map();

    constructor(docTicket: string, options: IrohFetchOptions = defaultOptions) {
        this.options = options;
        this.ticket = DocTicket.fromString(docTicket);
    }

    public async spawn() {
        let irohDataDir = app.getPath("appData") + "/thorium-reader/iroh";
        mkdirSync(irohDataDir, { recursive: true });
        
        this.node = await Iroh.persistent(irohDataDir, { blobEvents: (e,a) => { this.handleBlobEvent(e,a) } });
        this.author = await this.node.authors.default();
        this.nodeId = await this.node.net.nodeId();
        
        this.doc = await this.node.docs.join(this.ticket);
        await this.doc.setDownloadPolicy(DownloadPolicy.nothing());
        await this.doc.subscribe((e,a) => { this.handleDocumentEvent(e,a) });
        debug(`irohFetch initialized ${this.nodeId}, joined doc: ${this.doc.id()}`);
        let ticket = await this.doc.share(ShareMode.Write, AddrInfoOptions.Id);
        console.log(`shared ticket: ${ticket.toString()}`);
        this.spawned = true;
    }
    

    public async fetch(url: string): Promise<Response> {
        debug("fetch", url);
        if (!this.spawned) {
            throw new Error("IrohFetch not spawned");
        }
        let res
        // check the document for providers of this URL
        try {
            res = await this.fetchIroh(url);
            if (res !== null) {
                debug("returning response fetched from iroh", url);
                return res;
            }
        } catch (e) {
            debug("error fetching from iroh", e);
        }

        debug("url doesn't exist in iroh, fetching from web")
        // couldn't fetch via iroh, fall back to regular fetch
        metrics.httpRequestCount.inc(1);
        res = await fetch(url)
        if (res.ok) {
            await postRequestData(this.nodeId, 0, "Https", "Success", "", res.headers.get("Content-Length") ? parseInt(res.headers.get("content-length")!) : 0);
        }

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
        
        const [headerHash, bodyHash] = await this.urlHash(url);
        if (headerHash === "" || bodyHash === "") {
            debug("url not found in iroh", url);
            return null;
        }

        const providers = await this.possibleProviders();
        const headerData = await this.getHashBuffer(headerHash, providers);
        const header = IrohFetch.decodeHeader(headerData);
        const body = await this.getHashBuffer(bodyHash, providers);
        metrics.irohBytesFetched.inc(body.length);
        await postRequestData(this.nodeId, 0, "Iroh", "Success", bodyHash, body.length);
        return new Response(body, header);
    }

    private async getHashBuffer(hash: string, providers: string[]): Promise<Buffer> {
        await this.downloadBlob(hash, providers);
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

    private async downloadBlob(hash: string, providers: string[]) {
        debug(`asking ${providers.length} providers to get ${hash}`);
        // return Promise.race(providers.map((provider) => this.downloadBlob(hash, provider)));
        const downloadOptions = new BlobDownloadOptions(BlobFormat.Raw, providers.map((nodeId) => ({ nodeId })), SetTagOption.auto());
        // metrics.irohRequestCount.inc(1);
        await this.node.blobs.download(hash, downloadOptions, (err, progress) => {
            if (err) {
                debug(`download ${hash} error`, err);
            } else {
                debug("download progress", downloadProgressType(progress));
            }
        });
    }

    private async urlHash(url: string): Promise<[string, string]> {
        // get header hash
        let headerKey = Buffer.from(`${HEADER_PREFIX}${PROVIDER_SEPARATOR}${url}`, "utf-8");
        let query = Query.keyPrefix(Array.from(headerKey));
        let headerEntry = await this.doc.getOne(query);
        if (headerEntry === null) {
            return ["", ""];
        }
        const headerHash = headerEntry.hash;

        const buffer = Buffer.from(url, "utf-8");
        query = Query.keyPrefix(Array.from(buffer));
        let entries = await this.doc.getMany(query)
        if (entries.length === 0) {
            return ["", ""];
        }
        return [headerHash, entries[0].hash];
    }

    private async possibleProviders(): Promise<string[]> {
        // this is the list of online peers you're already connected to
        const peers = await this.doc.getSyncPeers();
        if (peers === null)  {
            return []
        }

        return peers.map((peer) => {
            return base32Encode(new Uint8Array(peer), 'RFC4648', { padding: false }).toLowerCase()
        })
    }

    private async localBlobs(): Promise<[string[], string[]]> {
        const entries = await this.doc.getMany(Query.all())
        const entriesMap = entries.reduce((acc: Map<string, boolean>, entry) => acc.set(entry.hash, true), new Map())

        let completeHashes = await this.node.blobs.list();
        completeHashes = completeHashes.filter((h) => entriesMap.get(h.toString()))
        let incompleteHashes = await this.node.blobs.listIncomplete();
        incompleteHashes = incompleteHashes.filter((h) => entriesMap.get(h.toString()))

        return [
            completeHashes.map((h) => h.toString()),
            incompleteHashes.map((h) => h.toString())
        ]
    }

    private async handleBlobEvent(err: Error | null, arg: BlobProvideEvent) {
        if (err) {
            debug("blob error", err);
            return;
        }
        debug("blob event", arg);
        if (arg.getRequestReceived) {
            let event = arg.getRequestReceived;
            this.provides.set(event.requestId.toString(), event.hash);
        }
        else if (arg.transferCompleted) {
            let event = arg.transferCompleted;
            let hash = this.provides.get(event.requestId.toString());
            if (hash) {
                debug(`transfer completed for ${hash}`);
                await postProvide(this.nodeId, Number(event.stats.duration), "Success", hash, 0);
                this.provides.delete(event.requestId.toString());
            }
        }
    }

    private async handleDocumentEvent(err: Error, arg: LiveEvent) {
        if (err) {
            debug("document error", err);
            return;
        }
        let type = liveEventType(arg);
        switch (type) {
            case LiveEventType.syncFinished:
                let entries = await this.doc.getMany(Query.all()).catch((e) => {
                    debug("error getting entries", e);
                    return [];
                });
                debug(`sync finished. Document has ${entries.length} entries`);
                const [completeHashes, incompleteHashes] = await this.localBlobs()
                await postDeviceDetails({
                    nodeId: this.nodeId,
                    timestamp: new Date(),
                    deviceCategory: 'Desktop',
                    completeHashes,
                    incompleteHashes,
                })
                break;
            default:
                debug("document event", liveEventType(arg));
        }
    }

}

enum DownloadProgressType {
    unknown = "unknown",
    /** Initial state if subscribing to a running or queued transfer. */
    initialState = "initialState",
    /** A new connection was established. */
    connected = "connected",
    /** An item was found with hash `hash`, from now on referred to via `id` */
    found = "found",
    /** Data was found locally */
    foundLocal = "foundLocal",
    /** An item was found with hash `hash`, from now on referred to via `id` */
    foundHashSeq = "foundHashSeq",
    /** We got progress ingesting item `id`. */
    progress = "progress",
    /** We are done with `id`, and the hash is `hash`. */
    done =  "downloadProgressDone",
    /** We are done with the whole operation. */
    allDone = "allDone"
}

function downloadProgressType(arg: DownloadProgress): DownloadProgressType {
    if (arg.initialState) { return DownloadProgressType.initialState; }
    else if (arg.connected) { return DownloadProgressType.connected; }
    else if (arg.found) { return DownloadProgressType.found; }
    else if (arg.foundLocal) { return DownloadProgressType.foundLocal; }
    else if (arg.foundHashSeq) { return DownloadProgressType.foundHashSeq; }
    else if (arg.progress) { return DownloadProgressType.progress; }
    else if (arg.done) { return DownloadProgressType.done; }
    else if (arg.allDone) { return DownloadProgressType.allDone; }
    else { return DownloadProgressType.unknown; }
}

enum LiveEventType {
    unknown = "unknown",
    insertLocal = "insertLocal",
    insertRemote = "insertRemote",
    contentReady = "contentReady",
    neighborUp = "neighborUp",
    neighborDown = "neighborDown",
    syncFinished = "syncFinished",
}

function liveEventType(arg: LiveEvent): LiveEventType {
    if (arg.contentReady) { return LiveEventType.contentReady; }
    else if (arg.insertLocal) { return LiveEventType.insertLocal; }
    else if (arg.insertRemote) { return LiveEventType.insertRemote; }
    else if (arg.neighborUp) { return LiveEventType.neighborUp; }
    else if (arg.neighborDown) { return LiveEventType.neighborDown; }
    else if (arg.syncFinished) { return LiveEventType.syncFinished; }
    else if (arg.pendingContentReady === true) { return LiveEventType.contentReady; }
    return LiveEventType.unknown;
}

// a demo ticket for testing, hosted on iroh.network
const DEMO_DOC_TICKET = "docaaacbyheqs6iy4mn7lehp5yg3v3zfk2iylmwzr2gwgfh5m7akhwbnjt6afk62aofuwwwu5zb5ocvzj5v3rtqt6siglyuhoxhqtu4fxravvoteaaa";

// a shared instance of IrohFetch for use in the app, in the real world this should be
// created on app startup and shared throughout the app
export const sharedIrohFetch = new IrohFetch(DEMO_DOC_TICKET);

(async () => {
    try {
        await sharedIrohFetch.spawn();
    } catch (e) {
        debug("error initializing sharedIrohFetch", e);
    }
})()
