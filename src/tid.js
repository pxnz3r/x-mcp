let instance = null;
let failedAt = 0;
const RETRY_FAILURE_MS = 10 * 60 * 1000;

async function getInstance() {
  if (instance) return instance;
  if (failedAt && Date.now() - failedAt < RETRY_FAILURE_MS) return null;

  const { ClientTransaction, fetchXDocument } = await import('x-client-transaction-id');
  const document = await fetchXDocument();
  instance = await ClientTransaction.create(document);
  return instance;
}

export async function transactionId(method, path) {
  if (process.env.X_CLIENT_TRANSACTION_ID) return process.env.X_CLIENT_TRANSACTION_ID;

  try {
    const tx = await getInstance();
    if (!tx) return null;
    return await tx.generateTransactionId(method, path);
  } catch {
    failedAt = Date.now();
    return null;
  }
}
