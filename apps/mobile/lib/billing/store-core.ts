export const STORE_PRODUCTS = {
  monthly: "com.knightaiav.dandelist.premium.monthly",
  annual: "com.knightaiav.dandelist.premium.annual",
} as const;
const products = new Set<string>(Object.values(STORE_PRODUCTS));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoreProduct {
  id: string;
  title: string;
  displayPrice: string;
  trialDays: number | null;
  offers: { token: string; basePlanId: string; displayPrice: string }[];
}
export interface StorePurchase {
  id: string;
  productId: string;
  platform: "ios" | "android";
  state: "pending" | "purchased" | "unknown";
  token: string | null;
  /** Native SDK purchase object. Never serialize this object or put it in application logs. */
  native: unknown;
}
export interface BillingAccess {
  state: "none" | "trialing" | "active" | "grace" | "expired" | "revoked";
  expiresAt: string | null;
  hasPremiumEntitlement: boolean;
}
export interface VerifiedStorePurchase {
  verified: true;
  userId: string;
  access: BillingAccess;
}
export interface StoreBridge {
  connect(onPurchase: (purchase: StorePurchase) => void, onError: (cancelled: boolean) => void): Promise<void>;
  products(): Promise<StoreProduct[]>;
  eligibleForTrial(productId: string): Promise<boolean>;
  buy(productId: string, userId: string, accountHash: string, offerToken?: string): Promise<void>;
  restore(): Promise<StorePurchase[]>;
  finish(purchase: StorePurchase): Promise<void>;
  close(): Promise<void>;
}
export type StoreState = { status: "idle" | "pending" | "verifying" | "complete" | "cancelled" | "retry"; access?: BillingAccess };
export interface StoreControllerOptions {
  enabled: boolean;
  userId: string;
  platform: "ios" | "android";
  /** Must remain true only for this signed-in account and its accepted consent version. */
  isCurrent(): boolean;
  accountHash(userId: string): Promise<string>;
  load(): Promise<StoreBridge>;
  verify(purchase: Pick<StorePurchase, "platform" | "productId" | "token">): Promise<VerifiedStorePurchase>;
  onState(state: StoreState): void;
}

/** Purchase results come from store events, never from the dispatch promise or the device clock. */
export class StoreController {
  private bridge?: StoreBridge;
  private preparation?: Promise<void>;
  private catalogue: StoreProduct[] = [];
  private closed = false;
  private buying = false;
  private pending = new Map<string, Promise<void>>();
  private completed = new Set<string>();
  constructor(private options: StoreControllerOptions) {}
  private guard() {
    if (!this.options.enabled || this.closed || !uuid.test(this.options.userId) || !this.options.isCurrent()) {
      throw new Error("Store access is unavailable for this session");
    }
  }
  private publish(state: StoreState) { if (!this.closed && this.options.isCurrent()) this.options.onState(state); }
  private async prepare() {
    this.guard();
    if (!this.preparation) this.preparation = this.initialize().catch(async (error) => {
      this.preparation = undefined;
      const bridge = this.bridge; this.bridge = undefined;
      await bridge?.close().catch(() => undefined);
      throw error;
    });
    await this.preparation; this.guard();
  }
  private async initialize() {
    const bridge = await this.options.load();
    try { this.guard(); } catch (error) { await bridge.close(); throw error; }
    this.bridge = bridge;
    await bridge.connect((purchase) => { void this.process(purchase).catch(() => this.publish({ status: "retry" })); }, (cancelled) => {
      this.buying = false;
      this.publish({ status: cancelled ? "cancelled" : "retry" });
    });
    this.guard();
    this.catalogue = (await bridge.products()).filter(p => products.has(p.id));
    this.guard();
  }
  async list(): Promise<StoreProduct[]> { await this.prepare(); return this.catalogue.map(p => ({ ...p, offers: p.offers.map(o => ({ ...o })) })); }
  async buy(productId: string, mode: "trial" | "subscribe", offerToken?: string): Promise<void> {
    this.guard();
    // Set before any await so two rapid taps cannot dispatch two store sheets.
    if (this.buying) throw new Error("A store request is already in progress");
    this.buying = true;
    try {
      await this.prepare();
      const product = this.catalogue.find(p => p.id === productId);
      if (!product) throw new Error("Product unavailable");
      if (mode === "trial") {
        if (this.options.platform !== "ios" || product.trialDays !== 14 || !await this.bridge!.eligibleForTrial(productId)) {
          throw new Error("Introductory trial unavailable");
        }
      }
      if (this.options.platform === "android" && (!offerToken || !product.offers.some(o => o.token === offerToken))) {
        throw new Error("Choose an available store offer");
      }
      const accountHash = await this.options.accountHash(this.options.userId);
      this.guard();
      if (!/^[a-f0-9]{64}$/.test(accountHash)) throw new Error("Invalid store account binding");
      this.publish({ status: "pending" });
      // No automatic retry: a dispatch error may occur after the store accepted the purchase.
      await this.bridge!.buy(productId, this.options.userId, accountHash, offerToken);
    } catch (error) { this.buying = false; throw error; }
  }
  private async process(purchase: StorePurchase): Promise<void> {
    this.guard();
    if (purchase.platform !== this.options.platform || !products.has(purchase.productId)) throw new Error("Unexpected store purchase");
    if (purchase.state === "pending") { this.publish({ status: "pending" }); return; }
    if (purchase.state !== "purchased" || !purchase.id || !purchase.token) throw new Error("Store purchase is incomplete");
    const key = `${purchase.platform}:${purchase.id}`;
    if (this.completed.has(key)) return;
    const running = this.pending.get(key);
    if (running) return running;
    const promise = this.verifyAndFinish(purchase).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  private async verifyAndFinish(purchase: StorePurchase) {
    this.publish({ status: "verifying" });
    const result = await this.options.verify({ platform: purchase.platform, productId: purchase.productId, token: purchase.token });
    this.guard();
    if (result.verified !== true || result.userId !== this.options.userId) throw new Error("Purchase was not verified for this account");
    // The service has persisted its decision before the store transaction is acknowledged.
    await this.bridge!.finish(purchase);
    this.guard();
    this.completed.add(`${purchase.platform}:${purchase.id}`);
    this.buying = false;
    this.publish({ status: "complete", access: result.access });
  }
  async restore(): Promise<void> {
    await this.prepare();
    const purchases = await this.bridge!.restore();
    this.guard();
    // Each purchase must independently pass account-bound server verification.
    const results = await Promise.allSettled(purchases.map(purchase => this.process(purchase)));
    if (results.some(r => r.status === "rejected")) { this.publish({ status: "retry" }); throw new Error("Some store purchases could not be verified"); }
    if (!purchases.length) this.publish({ status: "idle" });
  }
  async close() {
    this.closed = true;
    this.catalogue = [];
    this.completed.clear();
    const bridge = this.bridge; this.bridge = undefined;
    await bridge?.close();
  }
}
