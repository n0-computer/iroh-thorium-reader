import { Counter, Pushgateway } from 'prom-client';

export const pushGateway = new Pushgateway('https://localhost:9091', { jobName: 'readium-desktop' });

export const metrics = {
    httpBytesFetched: new Counter({
        name: 'readium_http_bytes_fetched',
        help: 'count of bytes fetched from http in readium-iroh demo',
    }),
    irohBytesFetched: new Counter({
        name: 'readium_iroh_bytes_fetched',
        help: 'count of bytes fetched from iroh in readium-iroh demo',
    }),
    httpRequestCount: new Counter({
        name: 'readium_http_request_count',
        help: 'count of bytes fetched total in readium-iroh demo',
    }),
    irohRequestCount: new Counter({
        name: 'readium_iroh_request_count',
        help: 'count of bytes fetched total in readium-iroh demo',
    }),
}

export const cdnMetricsGateway = 'https://cdn.gateway.lol/api'

interface DeviceDetails {
    nodeId: string,
    timestamp: Date,
    deviceCategory: 'Desktop' | 'Tablet' | 'Mobile',
    completeHashes: string[],
    incompleteHashes: string[]
}

export async function postDeviceDetails(d: DeviceDetails) {
    try {
        const response = await fetch(`${cdnMetricsGateway}/devices`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(d),
        });
    
        if (!response.ok) {
            throw new Error(`Failed to post usage: ${response.status}: ${await response.text()}`);
        }
    } catch (e) {
        console.error('Failed to post device details', e);
        // TODO: cache & attempt to re-send later
    }
}


interface PostUsageRequestParams {
    requests: RequestRecord[],
    provides: ProvideRecord[],
}

interface RequestRecord {
    requestor: string,
    duration: number,
    source: 'Https' | 'Iroh',
    result: 'Unknown' | 'Success' | 'Failure' | 'Partial',
    start: Date,
    hash: string,
    transferred: number,
}

export async function postRequestData(requestor: string, duration: number, source: 'Https' | 'Iroh', result: 'Unknown' | 'Success' | 'Failure' | 'Partial', hash: string, transferred: number) {
    try {
        await postUsage({
            requests: [{
                requestor,
                duration,
                source,
                result,
                start: new Date(),
                hash,
                transferred,
            }],
            provides: [],
        });
    } catch (e) {
        console.error('Failed to post request data', e);
        // TODO: cache & attempt to re-send later
    }
}

interface ProvideRecord {
    provider: string,
    duration: number,
    result: 'Unknown' | 'Success' | 'Failure' | 'Partial',
    start: Date,
    hash: string,
    transferred: number,
}

export async function postProvide(provider: string, duration: number, result: 'Unknown' | 'Success' | 'Failure' | 'Partial', hash: string, transferred: number) {
    try {
        await postUsage({
            requests: [],
            provides: [{
                provider,
                duration,
                result,
                start: new Date(),
                hash,
                transferred,
            }],
        });
    } catch (e) {
        console.error('Failed to post provide data', e);
        // TODO: cache & attempt to re-send later
    }
}

export async function postUsage(params: PostUsageRequestParams) {
    const response = await fetch(`${cdnMetricsGateway}/traffic`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        throw new Error(`Failed to post usage: ${response.status}: ${await response.text()}`);
    }
}