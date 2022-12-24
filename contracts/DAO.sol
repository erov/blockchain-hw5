// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 *  @dev Extended implementation of {ERC20} token.
 *  Provides DAO for voting for/against up to 3 proposals simultaneously.
 *  Doesn't freeze token on making vote.
 *  Supports token transferring to only account without any balance.
 *  If you've already voted and then transferred a part of your tokens,
 *  then your vote share becomes equal to your remaining balance. However,
 *  in case you transferred all tokens, your vote becomes into ABSTAIN state.
 *
 *  @author Egor Erov
 */
contract DAO is ERC20 {
    /**
     *  @dev Task statement specified constants.
     */
    uint8 constant DECIMALS = 6;
    uint256 constant VOTING_TTL = 3 days;
    uint256 constant PROPOSALS_QUEUE_LIMIT = 3;


    /**
     *  @dev Types of vote result. ABSTAIN -- the only usages:
     *    - As dummy value before any voting came up from account;
     *    - When handling account already voted and then transferred all his tokens
     *      into another account. This way, his his previous vote is declined and became ABSTAIN.
     */
    enum VOTE {
        ABSTAIN,
        FOR,
        AGAINST
    }

    /**
     *  @dev Types of proposal statuses. While voting is not over, the only state for proposal is QUEUED.
     *  Then, if result was determined until ttl exceeded, it becomes one of ACCEPTED or DECLINED, correspondingly to
     *  majority vote, otherwise it becomes DISCARDED.
     */
    enum PROPOSAL_STATUS {
        QUEUED,
        ACCEPTED,
        DECLINED,
        DISCARDED
    }

    /**
     *  @dev Structure for handling proposals.
     *  Invariant: {id} field is monotonic increase by one every new queued proposal.
     */
    struct Proposal {
        uint256 message;
        uint256 id;
        uint256 ttl;
        uint256 forVotesTotal;
        uint256 againstVotesTotal;
        PROPOSAL_STATUS status;
        mapping (address => VOTE) votes;
    }

    /**
     *  @dev History of all proposals that was propagated and queued to this contract.
     */
    Proposal[] public proposalArchive;
    /**
     *  @dev Active queue of recent propagations. It's length <= {PROPOSALS_QUEUE_LIMIT} .
     */
    uint256[] public proposalQueue;


    /**
     *  @dev Events for monitoring.
     *  The only {ProposalQueued} signalize about both {proposalMessage} and {id}.
     *  For every other event message can be recovered from this one.
     */
    event ProposalQueued(uint256 proposalMessage, uint256 id);
    event ProposalAccepted(uint256 id);
    event ProposalDeclined(uint256 id);
    event ProposalDiscarded(uint256 id);
    event Vote(address who, VOTE vote, uint256 id);


    /**
     *  @dev Checks that operation can be done only by token holder.
     */
    modifier holdersOnly() {
        require(balanceOf(msg.sender) != 0, "Only token holders can propagate & vote");
        _;
    }

    /**
     *  @dev Checks that proposal with specified {_proposalId} exists or was existed.
     */
    modifier knownProposal(uint256 _proposalId) {
        require(proposalArchive.length >= _proposalId, "Proposal with specified id not found");
        _;
    }


    /**
     *  @dev Mint initial {totalSupply} correspondingly to task statements.
     */
    constructor() ERC20("DAO", "DAO") {
        _mint(msg.sender, 100 * (10 ** DECIMALS));
    }


    /**
     *  @dev Overrides {ERC20} function. Just because token has 6 decimal instead of 18.
     */
    function decimals() public view virtual override returns (uint8) {
        return DECIMALS;
    }

    /**
     *  @dev Returns vote of specified {_address} for/against specified {_proposalId}.
     *
     *  Requirements:
     *      * address must be a token holder;
     *      * proposal must be known before this call.
     */
    function getProposalVote(address _address, uint256 _proposalId) public view knownProposal(_proposalId) returns (VOTE){
        require(balanceOf(_address) != 0, "Person must be a holder to have a possibility for voting");
        return proposalArchive[_proposalId].votes[_address];
    }

    /**
     *  @dev Getter for global {PROPOSALS_QUEUE_LIMIT}.
     */
    function getProposalQueueLimit() public pure returns (uint256) {
        return PROPOSALS_QUEUE_LIMIT;
    }

    /**
     *  @dev Returns actual amount of queued non-expired proposals.
     *  Slow as hell due to making non-view contract operations more productive.
     */
    function getQueuedProposalsAmount() public view returns (uint256) {
        uint256 actual = 0;
        for (uint256 i = 0; i != proposalQueue.length; ++i) {
            actual += (block.timestamp <= proposalArchive[proposalQueue[i]].ttl ? 1 : 0);
        }
        return actual;
    }

    /**
     *  @dev Getter for global {VOTING_TTL}.
     */
    function getVotingTtl() public pure returns (uint256) {
        return VOTING_TTL;
    }


    /**
     *  @dev Propagates a proposal into DAO. Proposal handles only
     *  if there is free space in {proposalQueue}. Also, trys to kick out
     *  already expired proposal, if there if no free space. And
     *  makes proposal status QUEUED -> DISCARDED.
     *  By doing this, it takes one whole {proposalQueue} lookup for
     *  removing the oldest one proposal.
     */
    function propagate(uint256 _proposalMessage) public holdersOnly {
        if (proposalQueue.length == PROPOSALS_QUEUE_LIMIT) {
            Proposal storage earliestActiveProposal = proposalArchive[proposalQueue[0]];
            if (earliestActiveProposal.ttl <= block.timestamp) {
                earliestActiveProposal.status = PROPOSAL_STATUS.DISCARDED;
                emit ProposalDiscarded(earliestActiveProposal.id);
                _dequeueProposal(earliestActiveProposal.id);
            } else {
                revert("Active proposals limit exceeded");
            }
        }

        uint256 proposalId = proposalArchive.length;
        Proposal storage proposal = proposalArchive.push();
        proposal.message = _proposalMessage;
        proposal.id = proposalId;
        proposal.ttl = block.timestamp + VOTING_TTL;
        proposal.forVotesTotal = 0;
        proposal.againstVotesTotal = 0;
        proposal.status = PROPOSAL_STATUS.QUEUED;

        proposalQueue.push(proposalId);
        emit ProposalQueued(_proposalMessage, proposalId);
    }


    /**
     *  @dev Apply vote from a holder. Maintains multiple times voting and saves
     *  only last one vote. After taking a vote into account, checks whether there is
     *  a majority vote for making voting complete.
     */
    function vote(uint256 _proposalId, VOTE _vote) public holdersOnly {
        // Firstly, I think to move these proposal checks into modifier,
        // but then I'll have double storage lookup, so I decided to take them here.
        Proposal storage proposal = proposalArchive[_proposalId];
        require(block.timestamp <= proposal.ttl, "Proposal with specified id has already expired");
        require(proposal.status == PROPOSAL_STATUS.QUEUED, "Proposal with specified id is already solved");

        require(_vote != VOTE.ABSTAIN, "You can only vote FOR or AGAINST");
        VOTE previousVote = proposal.votes[msg.sender];
        // For gas economy.
        require(previousVote != _vote, "You've already made the same vote");

        if (_vote == VOTE.FOR) {
            _voteFor(proposal, previousVote);
        } else {
            _voteAgainst(proposal, previousVote);
        }
    }


    /**
     *  @dev Apply vote 'for'. If it's not the first one vote,
     *  then declines results of previous one.
     */
    function _voteFor(Proposal storage proposal, VOTE previousVote) internal {
        uint256 balance = balanceOf(msg.sender);
        if (previousVote != VOTE.ABSTAIN) {
            proposal.againstVotesTotal -= balance;
        }
        proposal.forVotesTotal += balance;
        proposal.votes[msg.sender] = VOTE.FOR;
        emit Vote(msg.sender, VOTE.FOR, proposal.id);

        _checkProposalAcceptance(proposal);
    }

    /**
     *  @dev Apply vote 'against'. If it's not the first one vote,
     *  then declines results of previous one.
     */
    function _voteAgainst(Proposal storage proposal, VOTE previousVote) internal {
        uint256 balance = balanceOf(msg.sender);
        if (previousVote != VOTE.ABSTAIN) {
            proposal.forVotesTotal -= balance;
        }
        proposal.againstVotesTotal += balance;
        proposal.votes[msg.sender] = VOTE.AGAINST;
        emit Vote(msg.sender, VOTE.AGAINST, proposal.id);

        _checkProposalRejecting(proposal);
    }

    /**
     *  @dev Checks if there is majority vote of 'for' votes. This way,
     *  makes proposal status QUEUED -> ACCEPTED.
     */
    function _checkProposalAcceptance(Proposal storage _proposal) internal {
        if (_proposal.forVotesTotal > totalSupply() / 2) {
            _proposal.status = PROPOSAL_STATUS.ACCEPTED;
            emit ProposalAccepted(_proposal.id);
            _dequeueProposal(_proposal.id);
        }
    }

    /**
     *  @dev Checks if there is majority vote of 'for' votes. This way,
     *  makes proposal status QUEUED -> REJECTED.
     */
    function _checkProposalRejecting(Proposal storage _proposal) internal {
        if (_proposal.againstVotesTotal > totalSupply() / 2) {
            _proposal.status = PROPOSAL_STATUS.DECLINED;
            emit ProposalDeclined(_proposal.id);
            _dequeueProposal(_proposal.id);
        }
    }

    /**
     *  @dev Remove proposal from active queue by O(PROPOSAL_QUEUE_LIMIT).
     *  It's need for making every other reading of queue length works O(1).
     */
    function _dequeueProposal(uint256 _proposalId) internal {
        uint256 i;
        for (i = 0; i != proposalQueue.length; ++i) {
            if (proposalQueue[i] == _proposalId) {
                break;
            }
        }
        while (i + 1 != proposalQueue.length) {
            proposalQueue[i] = proposalQueue[i + 1];
            ++i;
        }
        proposalQueue.pop();
    }

    /**
     *  @dev Patch for {transfer}. Declines transactions for accounts that
     *  already held some tokens.
     */
    function _beforeTokenTransfer(address, address to, uint256) internal virtual override {
        require(balanceOf(to) == 0, "Transfer token to holders is forbidden");
    }

    /**
     *  @dev Patch for {transfer}. Updates every active proposal votes amount after
     *  applied transaction from holder ot non-holder. In case holder becomes a
     *  non-holder changes status of all his votes in proposals queue on ABSTAIN.
     */
    function _afterTokenTransfer(address from, address, uint256 amount) internal virtual override {
        for (uint256 i = 0; i != proposalQueue.length; ++i) {
            Proposal storage proposal = proposalArchive[proposalQueue[i]];
            if (proposal.votes[from] == VOTE.FOR) {
                proposal.forVotesTotal -= amount;
                if (balanceOf(from) == 0) {
                    proposal.votes[from] = VOTE.ABSTAIN;
                    emit Vote(from, VOTE.ABSTAIN, proposal.id);
                }
            } else if (proposal.votes[from] == VOTE.AGAINST) {
                proposal.againstVotesTotal -= amount;
                if (balanceOf(from) == 0) {
                    proposal.votes[from] = VOTE.ABSTAIN;
                    emit Vote(from, VOTE.ABSTAIN, proposal.id);
                }
            }
        }
    }

}