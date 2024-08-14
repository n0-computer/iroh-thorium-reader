import { Counter, Pushgateway } from 'prom-client';

export const pushGateway = new Pushgateway('http://localhost:9091', { jobName: 'readium-desktop' });

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