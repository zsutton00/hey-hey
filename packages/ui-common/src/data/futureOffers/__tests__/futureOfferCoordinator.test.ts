import { describe, expect, it } from "vitest";
import {
  ProposalAction,
  TargetEntityType,
  type FutureApplicationOffer,
  type ProposalResponseDto,
} from "../../../api";
import {
  futureOfferTaskIds,
  reviewedUnappliedOffers,
} from "../futureOfferCoordinator";

describe("completion offer selection", () => {
  it("retains independently blocked approved futures and removes unapproved/applied/cancelled futures", () => {
    const offers = [
      [],
      ["DEPENDENCIES_NOT_READY"],
      ["APPROVAL_REQUIRED"],
      ["APPLIED"],
      ["CANCELLED"],
    ].map((blockers, index) => ({
      futureId: String(index),
      applicability: { blockers },
    })) as FutureApplicationOffer[];
    expect(
      reviewedUnappliedOffers(offers).map((offer) => offer.futureId),
    ).toEqual(["0", "1"]);
  });
  it("reads completion intent from existing proposal content", () => {
    const proposal = {
      action: ProposalAction.Update,
      targetEntityType: TargetEntityType.Task,
      targetEntityId: "task",
      updates: { status: "COMPLETED" },
    } as ProposalResponseDto;
    expect(futureOfferTaskIds(proposal)).toEqual(["task"]);
    expect(
      futureOfferTaskIds({
        ...proposal,
        action: ProposalAction.VersionedUpdate,
      }),
    ).toEqual([]);
    expect(
      futureOfferTaskIds({ ...proposal, updates: { name: "Renamed" } }),
    ).toEqual([]);
  });
});
