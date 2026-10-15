const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * A thin json:api client. Every call is bounded by a timeout, since a hook that hangs on an
 * unreachable server would hold up the session it runs in.
 */
export async function request(baseUrl, path, { method = 'GET', token, body } = {}) {
  let response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.api+json',
        ...(body !== undefined ? { 'Content-Type': 'application/vnd.api+json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    throw new ApiError(0, `Could not reach ${baseUrl}: ${error.cause?.message ?? error.message}`);
  }

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not every error page is json.
  }

  if (!response.ok) {
    const detail = json?.errors?.[0]?.detail ?? json?.errors?.[0]?.title ?? json?.message ?? response.statusText;

    throw new ApiError(response.status, `${method} ${path} answered ${response.status}: ${detail}`);
  }

  return json;
}

/**
 * Every customer the user may book on, following json:api pagination.
 *
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function fetchCustomers(baseUrl, token) {
  const customers = [];

  for (let page = 1; page <= 50; page++) {
    const json = await request(baseUrl, `/customers?page[size]=500&page[number]=${page}`, { token });
    const data = json?.data ?? [];

    customers.push(...data.map((customer) => ({ id: Number(customer.id), name: customer.attributes?.name ?? '' })));

    if (data.length === 0 || !json?.links?.next) {
      break;
    }
  }

  return customers.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchCustomer(baseUrl, token, customerId) {
  const json = await request(baseUrl, `/customers/${encodeURIComponent(customerId)}`, { token });

  return { id: Number(json.data.id), name: json.data.attributes?.name ?? '' };
}
