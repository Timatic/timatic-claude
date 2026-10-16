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
 * Every resource behind a json:api index, following its pagination.
 */
async function fetchAll(baseUrl, token, path) {
  const resources = [];
  const separator = path.includes('?') ? '&' : '?';

  for (let page = 1; page <= 50; page++) {
    const json = await request(baseUrl, `${path}${separator}page[size]=500&page[number]=${page}`, { token });
    const data = json?.data ?? [];

    resources.push(...data);

    if (data.length === 0 || !json?.links?.next) {
      break;
    }
  }

  return resources;
}

/**
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function fetchCustomers(baseUrl, token) {
  return (await fetchAll(baseUrl, token, '/customers'))
    .map((customer) => ({ id: Number(customer.id), name: customer.attributes?.name ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toBudget(budget) {
  return {
    id: Number(budget.id),
    title: budget.attributes?.title ?? '',
    customerId: Number(budget.attributes?.customerId),
  };
}

/**
 * The budgets of one customer that work can still be booked on.
 *
 * @returns {Promise<Array<{id: number, title: string, customerId: number}>>}
 */
export async function fetchBudgets(baseUrl, token, customerId) {
  const path = `/budgets?filter[customerId]=${encodeURIComponent(customerId)}&filter[isArchived]=false`;

  return (await fetchAll(baseUrl, token, path))
    .map(toBudget)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * A ticket and the customer and budget Timatic maps it to, or null when no integration knows it.
 *
 * @returns {Promise<?{key: string, title: string, customerId: ?number, budgetId: ?number}>}
 */
export async function fetchTicket(baseUrl, token, key) {
  try {
    const json = await request(baseUrl, `/tickets/${encodeURIComponent(key)}`, { token });
    const attributes = json?.data?.attributes ?? {};

    return {
      key: attributes.key ?? key,
      title: attributes.title ?? '',
      customerId: attributes.customerId ?? null,
      budgetId: attributes.budgetId ?? null,
    };
  } catch (error) {
    if (error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function fetchBudget(baseUrl, token, budgetId) {
  const json = await request(baseUrl, `/budgets/${encodeURIComponent(budgetId)}`, { token });

  return toBudget(json.data);
}

export async function fetchCustomer(baseUrl, token, customerId) {
  const json = await request(baseUrl, `/customers/${encodeURIComponent(customerId)}`, { token });

  return { id: Number(json.data.id), name: json.data.attributes?.name ?? '' };
}
