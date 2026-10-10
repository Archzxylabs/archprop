import type { AssetId, PresentationStatus } from "@archprop/shared";
import { VILLA_NUSA } from "@archprop/shared";
import { chainUnavailable, type PropertyCardView } from "./view-models";

/**
 * Static, published presentation data for marketplace listings.
 *
 * This holds only what the product has published about each listing — names,
 * locations, issuers, and presentation status. It deliberately carries no
 * lifecycle, funding, balance, attestation, or claimable-revenue values:
 * those are chain-authoritative and must arrive through a `ChainDataState`.
 *
 * Villa Nusa's published fundamentals come from the frozen `VILLA_NUSA`
 * constant. Ubud Retreat and Lombok Residence exist for visual completeness
 * only and publish no fundamentals.
 */

export interface ListingSeed {
  assetId: AssetId | null;
  externalId: string;
  name: string;
  location: string;
  issuerName: string;
  imageUrl: string | null;
  presentationStatus: PresentationStatus;
  /** One-line truthful summary shown under the card title. */
  summary: string;
  /** Published fundamentals, or `null` when the listing publishes none. */
  fundamentals: PropertyCardView["fundamentals"];
}

export const LISTINGS: readonly ListingSeed[] = [
  {
    assetId: VILLA_NUSA.id,
    externalId: VILLA_NUSA.externalId,
    name: VILLA_NUSA.name,
    location: VILLA_NUSA.location,
    issuerName: VILLA_NUSA.issuerName,
    imageUrl: "/properties/villa-nusa.svg",
    presentationStatus: "VERIFICATION_PENDING",
    summary:
      "Primary demo asset. Ownership and valuation attestations are pending on-chain confirmation.",
    fundamentals: {
      indicativeValue: VILLA_NUSA.indicativeValue,
      offeringTarget: VILLA_NUSA.offeringTarget,
      tokenSupply: VILLA_NUSA.tokenSupply,
      tokenPrice: VILLA_NUSA.tokenPrice,
      tokenSymbol: VILLA_NUSA.tokenSymbol,
      economicRightsBps: VILLA_NUSA.economicRightsBps,
    },
  },
  {
    assetId: null,
    externalId: "ARCHPROP-002",
    name: "Ubud Retreat",
    location: "Ubud, Bali",
    issuerName: "PT Nusa Properties",
    imageUrl: "/properties/ubud-retreat.svg",
    presentationStatus: "COMING_SOON",
    summary:
      "Not yet open for investment. No on-chain asset has been created for this listing.",
    fundamentals: null,
  },
  {
    assetId: null,
    externalId: "ARCHPROP-003",
    name: "Lombok Residence",
    location: "Lombok, West Nusa Tenggara",
    issuerName: "PT Nusa Properties",
    imageUrl: "/properties/lombok-residence.svg",
    presentationStatus: "VERIFICATION_PENDING",
    summary:
      "Documents submitted for demo verification. Lifecycle status is unconfirmed until chain state is read.",
    fundamentals: null,
  },
] as const;

export function findListing(externalId: string): ListingSeed | undefined {
  return LISTINGS.find((listing) => listing.externalId === externalId);
}

export function findListingByAssetId(assetId: string): ListingSeed | undefined {
  return LISTINGS.find((listing) => listing.assetId === assetId);
}

/**
 * Builds the marketplace card view models.
 *
 * `readFunding` is supplied by the caller and must return chain-state funding
 * for an asset. It is never defaulted to a percentage: a listing with no chain
 * funding read renders an explicit unavailable state.
 */
export function buildMarketplaceCards(
  readFunding: (assetId: AssetId) => PropertyCardView["funding"],
): PropertyCardView[] {
  return LISTINGS.map((listing) => ({
    assetId: listing.assetId,
    externalId: listing.externalId,
    name: listing.name,
    location: listing.location,
    issuerName: listing.issuerName,
    imageUrl: listing.imageUrl,
    presentationStatus: listing.presentationStatus,
    fundamentals: listing.fundamentals,
    funding: listing.assetId
      ? readFunding(listing.assetId)
      : chainUnavailable(
          "No on-chain asset exists for this listing, so there is no funding to read.",
        ),
  }));
}

/** The one asset with full protocol functionality in the MVP. */
export const PRIMARY_ASSET = VILLA_NUSA;

/** The featured marketplace listing: the primary demo asset. */
const FEATURED_LISTING_INDEX = 0;
const FEATURED_LISTING_SEED = LISTINGS[FEATURED_LISTING_INDEX];
if (!FEATURED_LISTING_SEED) {
  throw new Error("Listing catalog is missing its primary demo asset.");
}
export const FEATURED_LISTING: ListingSeed = FEATURED_LISTING_SEED;
