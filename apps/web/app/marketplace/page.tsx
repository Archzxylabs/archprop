import type { AssetId } from "@archprop/shared";
import { VILLA_NUSA } from "@archprop/shared";
import { DemoDisclosure } from "@/components/demo-disclosure";
import { PropertyCatalog } from "@/components/property-catalog";
import { buildMarketplaceCards } from "@/lib/client/listings";
import {
  chainError,
  chainReady,
  chainUnavailable,
  type ChainDataState,
  type FundingView,
} from "@/lib/client/view-models";
import {
  deriveOfferingForAsset,
  describeOfferingEconomicsMismatch,
  getArchpropPublicClient,
  getClientChainConfig,
  inspectClientChainConfig,
} from "@/lib/client/chain-client";

/**
 * Marketplace listing.
 *
 * Funding is read from OfferingEscrow via public RPC when configuration is
 * present, without requiring a connected wallet. Missing or invalid config
 * or RPC errors show an unavailable or error state, never a fabricated balance,
 * status, or funding percentage. Ubud/Lombok remain non-investable seed cards.
 */

/**
 * Rendered on every request.
 *
 * Funding and offering state are chain-authoritative, so the page is never
 * frozen into a build-time static snapshot whose percentages would age into a
 * false claim about the offering.
 */
export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const config = getClientChainConfig();

  let readFunding: (assetId: AssetId) => ChainDataState<FundingView>;
  let villaNusaMismatch: string | null = null;

  if (config) {
    try {
      const client = getArchpropPublicClient(config);
      const villaNusaOffering = await deriveOfferingForAsset(
        client,
        config.addresses,
        VILLA_NUSA.id,
      );

      villaNusaMismatch = describeOfferingEconomicsMismatch(villaNusaOffering, {
        tokenPrice: VILLA_NUSA.tokenPrice,
        offeringTarget: VILLA_NUSA.offeringTarget,
      });

      readFunding = (assetId: AssetId): ChainDataState<FundingView> => {
        if (assetId.toLowerCase() === VILLA_NUSA.id.toLowerCase()) {
          if (villaNusaOffering) {
            const percentBps =
              villaNusaOffering.target > 0n
                ? Number(
                    (villaNusaOffering.raised * 10_000n) /
                      villaNusaOffering.target,
                  )
                : 0;
            return chainReady({
              raisedAmount: villaNusaOffering.raised,
              targetAmount: villaNusaOffering.target,
              percentBps,
            });
          }
          return chainUnavailable(
            "No confirmed offering found in OfferingEscrow for this asset.",
          );
        }
        return chainUnavailable(
          "Coming soon — no on-chain offering exists for this property.",
        );
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      readFunding = () =>
        chainError(`Failed to read from OfferingEscrow: ${reason}`);
    }
  } else {
    const report = inspectClientChainConfig();
    const reason =
      report.errors.length > 0
        ? `Chain configuration incomplete: ${report.errors.join("; ")}`
        : "Chain configuration unavailable in this environment.";
    readFunding = (assetId: AssetId) => {
      if (assetId.toLowerCase() === VILLA_NUSA.id.toLowerCase()) {
        return chainUnavailable(reason);
      }
      return chainUnavailable(
        "Coming soon — no on-chain offering exists for this property.",
      );
    };
  }

  const cards = buildMarketplaceCards(readFunding);

  return (
    <div className="ap-page marketplace-page" id="top">
      <header className="ap-page-heading">
        <p className="eyebrow">
          <span className="eyebrow-line" /> MARKETPLACE / THE PROPERTY
          COLLECTION
        </p>
        <h1>
          Real places.
          <br />
          <em>New possibilities</em>
        </h1>
        <p>
          Explore the property, understand its economic rights, and follow
          confirmed funding from the chain.
        </p>
      </header>
      <DemoDisclosure className="mt-6" />
      <section className="marketplace-catalog" aria-label="Property listings">
        <PropertyCatalog cards={cards} mismatch={villaNusaMismatch} />
      </section>
    </div>
  );
}
