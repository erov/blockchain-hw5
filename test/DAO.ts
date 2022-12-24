import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import {failure} from "hardhat/internal/core/config/config-validation";

let owner;
let A;      // 25 tokens
let B;      // 40 tokens
let C;      // 35 tokens
// Random accounts for testing transfer:
let D;
let E;
// DAO contract address:
let Dao;


// Expected properties:
const DECIMALS = 6;
const TOTAL_SUPPLY = 100;
const DAO = 10 ** DECIMALS;
const VOTING_TTL = 3 * 24 * 60 * 60;

beforeEach(async function () {
    // Get a couple of accounts for testing
    [owner, A, B, C, D, E] = await ethers.getSigners();

    // Get factory for deploying contract
    let DaoFactory = await ethers.getContractFactory("DAO");

    // Deploy contract
    Dao = await DaoFactory.deploy();
    await Dao.deployed();

    // Make scenario from sample
    await Dao.connect(owner).transfer(A.address, 25 * DAO);
    await Dao.connect(owner).transfer(B.address, 40 * DAO);
    await Dao.connect(owner).transfer(C.address, 35 * DAO);
});


describe("Common contract properties test", function () {
    it ("Decimals test", async function() {
        expect(await Dao.decimals()).to.equal(
            DECIMALS,
            "Token DAO must have 6 decimals"
        );
    });
    
    it ("TotalSupply test", async function() {
        expect(await Dao.totalSupply()).to.equal(
            100 * 10 ** DECIMALS,
            "Total supply must be 100 DAO after deploying"
        );
    });
    
    it ("Voting ttl test", async function() {
        expect(await Dao.getVotingTtl()).to.equal(
            VOTING_TTL,
            "Voting ttl must be 3 days"
        );
    });

    it ("Proposal queue limit test", async function() {
        expect(await Dao.getProposalQueueLimit()).to.equal(
            3,
            "Proposal queue size limit must be 3"
        );
    })
    
    it ("Sample scenario balances test", async function() {
        expect(await Dao.balanceOf(owner.address)).to.equal(
            0,
            "Owner balance must be 0 DAO"
        );
        expect(await Dao.balanceOf(A.address)).to.equal(
            25 * DAO,
            "A balance must be 25 DAO"
        );
        expect(await Dao.balanceOf(B.address)).to.equal(
            40 * DAO,
            "B balance must be 40 DAO"
        );
        expect(await Dao.balanceOf(C.address)).to.equal(
            35 * DAO,
            "C balance must be 35 DAO"
        );
        expect(await Dao.balanceOf(D.address)).to.equal(
            0,
            "D balance must be 0 DAO"
        )
        expect(await Dao.balanceOf(E.address)).to.equal(
            0,
            "E balance must be 0 DAO"
        );
    });
});

enum VOTE {
    ABSTAIN,
    FOR,
    AGAINST
}

enum PROPOSAL_STATUS {
    QUEUED,
    ACCEPTED,
    DECLINED,
    DISCARDED
}

function makeProposalMessage(message: string) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(message))
}

function expectProposal(found: any, expected: any) {
    for (const [key, value] of Object.entries(expected)) {
        expect(found[key]).to.equal(
            value,
            key + " is wrong"
        );
    }
}

async function checkProposalAndState(msg, id, total) {
    expect(await Dao.connect(A).propagate(msg)).to.emit(
        Dao, 'ProposalQueued'
    ).withArgs(msg, id);

    expect(await Dao.connect(A).getQueuedProposalsAmount()).to.equal(
        total,
        `Dao must have ${total} queued proposal`
    );

    expectProposal(
        await Dao.connect(A).proposalArchive(id),
        {
            message: msg,
            id: id,
            ttl: (await time.latest()) + VOTING_TTL,
            forVotesTotal: 0,
            againstVotesTotal: 0
        }
    );
}

async function propagateNProposals(msgs, id) {
    for (const msg of msgs) {
        await checkProposalAndState(msg, id, id + 1);
        ++id;
    }
}


describe("Proposal propagation test", function() {
    it ("Propagate 1 proposal as non-holder -- revert", async function() {
        await expect(Dao.connect(D).propagate(makeProposalMessage("0"))).to.be.revertedWith(
            "Only token holders can propagate & vote"
        );
    });

    it("Propagate 1 proposal", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );
    });

    it("Propagate 3 proposals", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0"),
                makeProposalMessage("1"),
                makeProposalMessage("2")
            ],
            0
        );
    });

    it ("Propagate 4 proposals -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0"),
                makeProposalMessage("1"),
                makeProposalMessage("2")
            ],
            0
        );
        await expect(Dao.connect(A).propagate(makeProposalMessage("3"))).to.be.revertedWith(
            "Active proposals limit exceeded"
        );
    });

    it ("Propagate 3 proposals & 1 after voting ttl expired", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0"),
                makeProposalMessage("1"),
                makeProposalMessage("2")
            ],
            0
        );
        await time.increaseTo((await time.latest()) + VOTING_TTL + 1);
        const msg3 = makeProposalMessage("3");
        await checkProposalAndState(msg3, 3, 1);
    });

    it ("Two proposals with same message", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            1
        );
    });
});


describe("Voting test", async function () {
    it ("A for, B for", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        expect(await Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        expect(await Dao.connect(B).vote(0, VOTE.FOR))
            .to.emit(
                Dao, 'Vote'
        ).withArgs(B.address, VOTE.FOR, 0)
            .to.emit(
                Dao, 'ProposalAccepted'
        ).withArgs(0);

    });

    it ("A for, proposal expired, B for -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        expect(await Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        await time.increaseTo((await time.latest()) + VOTING_TTL + 1);

        await expect(Dao.connect(B).vote(0, VOTE.FOR)).to.be.revertedWith(
            "Proposal with specified id has already expired"
        );
    });

    it ("A for, B for, C against -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        expect(await Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        expect(await Dao.connect(B).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.FOR, 0)

        await expect(Dao.connect(C).vote(0, VOTE.AGAINST)).to.be.revertedWith(
            "Proposal with specified id is already solved"
        );
    });

    it ("A for, proposal expired, check queued amount", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        expect(await Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        await time.increaseTo((await time.latest()) + VOTING_TTL + 1);

        expect(await Dao.getQueuedProposalsAmount()).to.equal(
            0,
            "There must be no proposals in queue"
        );
    });

    it ("A against, B for, C against (all three votes are needed)", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        expect(await Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

        expect(await Dao.connect(B).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.FOR, 0);

        expect(await Dao.connect(C).vote(0, VOTE.AGAINST))
            .to.emit(
            Dao, 'Vote'
        ).withArgs(C.address, VOTE.AGAINST, 0)
            .to.emit(
                Dao, 'ProposalDeclined'
        ).withArgs(0);
    });

    it ("Vote ABSTAIN -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.ABSTAIN)).to.be.revertedWith(
            "You can only vote FOR or AGAINST"
        );
    });

    it ("Vote as non-handler -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        await expect(Dao.connect(D).vote(0, VOTE.FOR)).to.be.revertedWith(
            "Only token holders can propagate & vote"
        );

    });

    it ("Vote second time differently: for -> against", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        await time.increaseTo((await time.latest()) + VOTING_TTL / 2);

        await expect(Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

    });

    it ("Vote second time differently: against -> for", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

        await time.increaseTo((await time.latest()) + VOTING_TTL / 2);

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

    });

    it ("Vote second time the same way -- revert", async function() {
        await propagateNProposals(
            [
                makeProposalMessage("0")
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        await time.increaseTo((await time.latest()) + VOTING_TTL / 2);

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.be.revertedWith(
            "You've already made the same vote"
        );

    });

});

describe("Transfer test", function () {
    it ("A for, B against, A -> D all tokens, D against", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        await time.increaseTo((await time.latest()) + 60);

        await expect(Dao.connect(B).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 25 * DAO,
            againstVotesTotal: 40 * DAO
        });

        expect(await Dao.connect(A).transfer(D.address, await Dao.balanceOf(A.address))).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.ABSTAIN, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 40 * DAO
        });

        expect(await Dao.connect(D).vote(0, VOTE.AGAINST))
            .to.emit(
                Dao, 'Vote'
        ).withArgs(D.address, VOTE.AGAINST, 0)
            .to.emit(
                Dao, 'ProposalDeclined'
        ).withArgs(0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 65 * DAO
        });
    });

    it ("A -> B all tokens -- revert", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(A).transfer(B.address, await Dao.balanceOf(A.address))).to.be.revertedWith(
            "Transfer token to holders is forbidden"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 0
        });
    });

    it ("B for, C against, A -> D 10 tokens, D for, A for, accepted", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(B).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 40 * DAO,
            againstVotesTotal: 0
        });

        await time.increaseTo((await time.latest()) + 60);

        await expect(Dao.connect(C).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(C.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 40 * DAO,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(A).transfer(D.address, 10 * DAO);

        expect(await Dao.balanceOf(A.address)).to.equal(
            15 * DAO,
            "A balance must be 15 DAO"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 40 * DAO,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(D).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(D.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 50 * DAO,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(A).vote(0, VOTE.FOR))
            .to.emit(
                Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0)
            .to.emit(
                Dao, 'ProposalAccepted'
        ).withArgs(0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 65 * DAO,
            againstVotesTotal: 35 * DAO
        });

    });

    it ("A against, C for, A -> D 10 token, B against, declined", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 25 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await expect(Dao.connect(C).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(C.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 25 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(A).transfer(D.address, 10 * DAO);

        expect(await Dao.balanceOf(A.address)).to.equal(
            15 * DAO,
            "A balance must be 15 DAO"
        );

        expect(await Dao.balanceOf(D.address)).to.equal(
            10 * DAO,
            "D balance must be 10 DAO"
        );

        expect(await Dao.getProposalVote(A.address, 0)).to.equal(
            VOTE.AGAINST,
            "A must still vote against"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 15 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(B).vote(0, VOTE.AGAINST))
            .to.emit(
                Dao, 'Vote'
        ).withArgs(B.address, VOTE.AGAINST, 0)
            .to.emit(
                Dao, 'ProposalDeclined'
        ).withArgs(0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 55 * DAO
        });
    });

    it ("A for, C against, A -> D all tokens, D -> A all tokens, A for, B for, accepted", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 25 * DAO,
            againstVotesTotal: 0
        });

        await time.increaseTo((await time.latest()) + 60);

        await expect(Dao.connect(C).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(C.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 25 * DAO,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(A).transfer(D.address, await Dao.balanceOf(A.address));

        expect(await Dao.balanceOf(A.address)).to.equal(
            0,
            "A balance must be 0 DAO"
        );

        expect(await Dao.balanceOf(D.address)).to.equal(
            25 * DAO,
            "D balance must be 25 DAO"
        );

        expect(await Dao.getProposalVote(D.address, 0)).to.equal(
            VOTE.ABSTAIN,
            "D must abstain"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(D).transfer(A.address, await Dao.balanceOf(D.address));

        expect(await Dao.balanceOf(D.address)).to.equal(
            0,
            "D balance must be 0 DAO"
        );

        expect(await Dao.balanceOf(A.address)).to.equal(
            25 * DAO,
            "A balance must be 25 DAO"
        );

        expect(await Dao.getProposalVote(A.address, 0)).to.equal(
            VOTE.ABSTAIN,
            "A must abstain"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(A).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 25 * DAO,
            againstVotesTotal: 35 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(B).vote(0, VOTE.FOR))
            .to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.FOR, 0)
            .to.emit(
            Dao, 'ProposalAccepted'
        ).withArgs(0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 65 * DAO,
            againstVotesTotal: 35 * DAO
        });
    });

    it ("A against, C for, A -> D all tokens, D -> A all tokens, A against, B against, declined", async function() {
        const msg = makeProposalMessage("0");
        await propagateNProposals(
            [
                msg
            ],
            0
        );

        await expect(Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 0,
            againstVotesTotal: 25 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await expect(Dao.connect(C).vote(0, VOTE.FOR)).to.emit(
            Dao, 'Vote'
        ).withArgs(C.address, VOTE.FOR, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 25 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(A).transfer(D.address, await Dao.balanceOf(A.address));

        expect(await Dao.balanceOf(A.address)).to.equal(
            0,
            "A balance must be 0 DAO"
        );

        expect(await Dao.balanceOf(D.address)).to.equal(
            25 * DAO,
            "D balance must be 25 DAO"
        );

        expect(await Dao.getProposalVote(D.address, 0)).to.equal(
            VOTE.ABSTAIN,
            "D must abstain"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 0
        });

        await time.increaseTo((await time.latest()) + 60);

        await Dao.connect(D).transfer(A.address, await Dao.balanceOf(D.address));

        expect(await Dao.balanceOf(D.address)).to.equal(
            0,
            "D balance must be 0 DAO"
        );

        expect(await Dao.balanceOf(A.address)).to.equal(
            25 * DAO,
            "A balance must be 25 DAO"
        );

        expect(await Dao.getProposalVote(A.address, 0)).to.equal(
            VOTE.ABSTAIN,
            "A must abstain"
        );

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 0
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(A).vote(0, VOTE.AGAINST)).to.emit(
            Dao, 'Vote'
        ).withArgs(A.address, VOTE.AGAINST, 0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 25 * DAO
        });

        await time.increaseTo((await time.latest()) + 60);

        expect(await Dao.connect(B).vote(0, VOTE.AGAINST))
            .to.emit(
            Dao, 'Vote'
        ).withArgs(B.address, VOTE.AGAINST, 0)
            .to.emit(
            Dao, 'ProposalDeclined'
        ).withArgs(0);

        expectProposal(await Dao.proposalArchive(0), {
            message: msg,
            id: 0,
            forVotesTotal: 35 * DAO,
            againstVotesTotal: 65 * DAO
        });
    });

});
