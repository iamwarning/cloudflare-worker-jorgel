const CF_APP_VERSION = '1.0.0'

const headers = [
    "rMeth",
    "rUrl",
    "uAgent",
    "cfRay",
    "cIP",
    "statusCode",
    "contentLength",
    "cfCacheStatus",
    "contentType",
    "responseConnection",
    "requestConnection",
    "cacheControl",
    "acceptRanges",
    "expectCt",
    "expires",
    "lastModified",
    "vary",
    "server",
    "etag",
    "date",
    "transferEncoding",
]

const options = {
    metadata: headers.map(value => ({ field: value })),
}

const sleep = (() => {
    const cache = {};
    return async ms => {
        if (!cache[ms]) {
            cache[ms] = new Promise(resolve => setTimeout(resolve, ms));
        }
        return cache[ms];
    };
})();


const makeId = length => {
    const possible = "ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789";
    return Array.from({length}, () => possible.charAt(Math.floor(Math.random() * possible.length))).join("");
}

const buildLogMessage = (request, response) => {
    const logDefs = {
        requestMethod: request.method,
        requestUrl: request.url,
        userAgent: request.headers.get("user-agent"),
        cfRay: request.headers.get("cf-ray"),
        cfConnectionIP: request.headers.get("cf-connecting-ip"),
        statusCode: response.status,
        contentLength: response.headers.get("content-length"),
        cfCacheStatus: response.headers.get("cf-cache-status"),
        contentType: response.headers.get("content-type"),
        responseConnection: response.headers.get("connection"),
        requestConnection: request.headers.get("connection"),
        cacheControl: response.headers.get("cache-control"),
        acceptRanges: response.headers.get("accept-ranges"),
        expectCt: response.headers.get("expect-ct"),
        expires: response.headers.get("expires"),
        lastModified: response.headers.get("last-modified"),
        vary: response.headers.get("vary"),
        server: response.headers.get("server"),
        etag: response.headers.get("etag"),
        date: response.headers.get("date"),
        transferEncoding: response.headers.get("transfer-encoding"),
    }

    const logArray = []
    options.metadata.forEach(entry => logArray.push(logDefs[entry.field]))
    return logArray.join(" | ")
}

const buildMetadataFromHeaders = headers => {
    const responseMetadata = {}
    Array.from(headers).forEach(([key, value]) => {
        responseMetadata[key.replace(/-/g, "_")] = value
    })
    return responseMetadata
}

// Batching
const BATCH_INTERVAL_MS = 500
const MAX_REQUESTS_PER_BATCH = 100
const WORKER_ID = makeId(6)

let workerTimestamp

let batchTimeoutReached = true
let logEventsBatch = []

// Backoff
const BACKOFF_INTERVAL = 10000
let backoff = 0

async function addToBatch(body, connectingIp, event) {
    logEventsBatch.push(body)

    if (logEventsBatch.length >= MAX_REQUESTS_PER_BATCH) {
        event.waitUntil(postBatch(event))
    }

    return true
}

/**
 * Cloudflare Worker that logs requests and responses to an external service(Logtail).
 * It builds a log message from the request and response, stores it in an array, and then posts
 * the array of log messages to an external service when the array reaches a certain size or
 * after a certain amount of time. It also has backoff logic in case the external service
 * responds with a 403 or 429 status code.
 * @param event
 * @returns {Promise<*>}
 */
async function handleRequest(event) {
    const { request } = event

    const requestMetadata = buildMetadataFromHeaders(request.headers)

    const t1 = Date.now()
    const response = await fetch(request)
    const originTimeMs = Date.now() - t1

    const requestUrl = request.url
    const requestMethod = request.method
    const requestCf = request.cf

    if (!!requestCf) {
        if (!!requestCf.tlsClientAuth) {
            delete requestCf.tlsClientAuth
        }

        if (!!requestCf.tlsExportedAuthenticator) {
            delete requestCf.tlsExportedAuthenticator
        }
    }

    const responseMetadata = buildMetadataFromHeaders(response.headers)

    const eventBody = {
        message: buildLogMessage(request, response),
        datetime: new Date().toISOString(),
        metadata: {
            response: {
                headers: responseMetadata,
                origin_time: originTimeMs,
                status_code: response.status,
            },
            request: {
                url: requestUrl,
                method: requestMethod,
                headers: requestMetadata,
                cf: requestCf,
            },
            cloudflare_worker: {
                version: CF_APP_VERSION,
                worker_id: WORKER_ID,
                worker_started: workerTimestamp,
            },
        },
    }
    event.waitUntil(
        addToBatch(eventBody, requestMetadata.cf_connecting_ip, event),
    )

    return response
}

const fetchAndSetBackOff = async (lfRequest, event) => {
    if (backoff <= Date.now()) {
        const resp = await fetch(LOG_TAIL_URL, lfRequest)
        if (resp.status === 403 || resp.status === 429) {
            backoff = Date.now() + BACKOFF_INTERVAL
        }
    }

    event.waitUntil(scheduleBatch(event))

    return true
}

const postBatch = async event => {
    const batchInFlight = [...logEventsBatch]
    logEventsBatch = []
    const requestHost = batchInFlight[0].metadata.request.headers.host
    const body = JSON.stringify(batchInFlight)
    const request = {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY_LOG_TAIL}`,
            "Content-Type": "application/json",
            "User-Agent": `Cloudflare Worker via ${requestHost}`,
        },
        body,
    }
    event.waitUntil(fetchAndSetBackOff(request, event))
}

const scheduleBatch = async event => {
    if (batchTimeoutReached) {
        batchTimeoutReached = false
        await sleep(BATCH_INTERVAL_MS)
        if (logEventsBatch.length > 0) {
            event.waitUntil(postBatch(event))
        }
        batchTimeoutReached = true
    }
    return true
}

addEventListener("fetch", (event) => {
    event.passThroughOnException()

    if (!workerTimestamp) {
        workerTimestamp = new Date().toISOString()
    }

    event.waitUntil(scheduleBatch(event))
    event.respondWith(handleRequest(event))
})
