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
import { execSync } from "node:child_process";

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
  ticket: string,
): SagaGenerator<[publicationDocument: PublicationDocument | undefined, alreadyImported: boolean]> {
  debug("importing ticket", ticket);
  const command = `/Users/dignifiedquire/rust_target/debug/sendme receive ${ticket}`;
  const res = execSync(command);
  const out = res.toString();
   const regex = /downloading\sto:\s([^;]+)/i;
    const fileOrPackagePath = out.match(regex)[1];
    debug(res, fileOrPackagePath)

    if (fileOrPackagePath) {
        return yield* callTyped(importLinkFromPath, fileOrPackagePath);
    } else {
        debug("downloaded file path or package path is empty");
    }

    return [undefined, false];
}
