// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as debug_ from "debug";
import { PublicationDocument } from "readium-desktop/main/db/document/publication";
import { diMainGet } from "readium-desktop/main/di";
import { delay, SagaGenerator } from "typed-redux-saga";
import { call as callTyped, race as raceTyped } from "typed-redux-saga/macro";

import { importFromFsService } from "./importFromFs";
import { Iroh, BlobTicket, BlobFormat, BlobExportFormat, BlobExportMode } from "@number0/iroh";
import { pushGateway, sharedIrohFetch } from "readium-desktop/main/irohFetch";
import { writeFileSync } from "fs";

// Logger
const debug = debug_("readium-desktop:main#saga/api/publication/importFromLinkService");

function* importLinkFromPath(
    downloadPath: string,
): SagaGenerator<[publicationDocument: PublicationDocument, alreadyImported: boolean]> {

    // Import downloaded publication in catalog
  const lcpHashedPassphrase: string | undefined = undefined;

    const { b: [publicationDocument, alreadyImported] } = yield* raceTyped({
        a: delay(30000),
        b: callTyped(importFromFsService, downloadPath, lcpHashedPassphrase),
    });

    let returnPublicationDocument = publicationDocument;
    if (!alreadyImported && publicationDocument) {
      const tags: string[] = [];

        // Merge with the original publication
        const publicationDocumentAssigned = Object.assign(
            {},
            publicationDocument,
            {
                // resources: {
                //     r2PublicationJson: publicationDocument.resources.r2PublicationJson,
                //     // r2LCPJson: publicationDocument.resources.r2LCPJson,
                //     // r2LSDJson: publicationDocument.resources.r2LSDJson,
                //     // r2OpdsPublicationJson: pub?.r2OpdsPublicationJson || undefined,

                //     // Legacy Base64 data blobs
                //     //
                //     // r2PublicationBase64: publicationDocument.resources.r2PublicationBase64,
                //     // r2LCPBase64: publicationDocument.resources.r2LCPBase64,
                //     // r2LSDBase64: publicationDocument.resources.r2LSDBase64,
                //     // r2OpdsPublicationBase64: pub?.r2OpdsPublicationBase64 || "",
                // } as Resources,
                tags,
            },
        );

        const publicationRepository = diMainGet("publication-repository");
        returnPublicationDocument = yield* callTyped(() => publicationRepository.save(publicationDocumentAssigned));

    }

    return [returnPublicationDocument, alreadyImported];

}

export function* importFromIrohService(
  ticketString: string,
): SagaGenerator<[publicationDocument: PublicationDocument | undefined, alreadyImported: boolean]> {
    if (ticketString.startsWith("http")) {
        debug("fetching URL:", ticketString);
        const res = yield* callTyped(() => sharedIrohFetch.fetch(ticketString));
        if (!res) {
            debug("fetch failed");
            return [undefined, false];
        }

        pushGateway.pushAdd({ jobName: "readium-desktop" }).then(({resp}) => {
            debug("pushGateway.pushAdd response:", resp);
        }).catch((err) => {
            debug("pushGateway.pushAdd error:", err);
        })
        const body = yield* callTyped(() => res.arrayBuffer());
        const destination = `/tmp/book.epub`;
        writeFileSync(destination, Buffer.from(body));
        return yield* callTyped(importLinkFromPath, destination);
    }

    debug("importing ticket", ticketString);
    const ticket = BlobTicket.fromString(ticketString)
    if (!ticket.hash || !ticket.nodeAddr.nodeId) {
        debug("invalid ticket, assuming it's a regular URL", ticketString);
        return [undefined, false];
    }

    const fileOrPackagePath = yield* callTyped(fetchIroh, ticket);
    if (!fileOrPackagePath) {
        debug("downloaded file path or package path is empty");
        return [undefined, false];
    }
    debug("fetched to", fileOrPackagePath)
    return yield* callTyped(importLinkFromPath, fileOrPackagePath);
}

async function fetchIroh(ticket: BlobTicket): Promise<string> {
    const node = await Iroh.memory();
    let fileOrPackagePath = "";
    debug("downloading", ticket.hash, ticket.asDownloadOptions());
    await node.blobs.download(ticket.hash, ticket.asDownloadOptions(), async (err, progress) => {
        if (err) {
            debug("download error", err);
            return;
        }
        debug("download progress", progress);
    });

    const destination = `/tmp/${ticket.hash}`;
    const blobExportFormat = (ticket.format === "HashSeq") ? BlobExportFormat["Collection"]: BlobExportFormat["Blob"];
    try {
        debug("exporting", ticket.hash, blobExportFormat, destination)
        await node.blobs.export(ticket.hash, destination, blobExportFormat, BlobExportMode["TryReference"])
    } catch (e) {
        debug(`error exporting: ${e}`)
    }

    switch (ticket.format) {
        case BlobFormat["HashSeq"]:
            const collection = await node.blobs.getCollection(ticket.hash)
            fileOrPackagePath = `${destination}/${collection.names()[0]}`
            break;
        case BlobFormat["Raw"]:
            fileOrPackagePath = destination;
            break;
        default:
            debug("invalid ticket format", ticket.format);
    }

    debug("package path:", fileOrPackagePath)
    return fileOrPackagePath;
}
