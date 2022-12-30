# DAO contract

An ERC20 extended implementation that allows vote for/against some proposals. For more clarifications, see 'Requirements' part.
Besides, there some thoughts about implementation and why it's done like this.

1. It's allowed to transfer token only to addresses that have balance equals to 0 tokens. In case, we cannot freeze any token for voting time, it becomes hard to manage transaction from holder to holder, cause we cannot clearly say, which part of second holder tokens already has non-zero shares in voting and which one - hasn't. However, there is supported mechanism of saving already applied vote shares, when after transferring there are some token remains on address. Otherwise, the vote declines and holder becomes a non-holder.
2. It's allowed to change your already done vote into opposite one any times you want until proposal TTL expiration or the decision about proposal is made.
3. It's allowed to have different proposals with the same messages. Cause checking this thing costs us a lot of gas wasting due to O(n) storage lookups. So, if it's important to have a distinct proposals, please, take care about it by yourselves.

I guess, code is good doced, so you can find any needed function explanation inside.

## Preparing 
Node.js must be installed before work starting. Moreover, there are some modules that we need in:
```
npm install --save-dev hardhat
npm install module '@openzeppelin/contracts'
```

## Usage
``` 
$ export ALCHEMY_TOKEN=<YOUR ALCHEMY TOKEN>
$ npx hardhat test  # for testing only
$ npx hardnat coverage  # for testing with coverage
```

## Sample of usage
``` 
$ npx hardnat coverage

Version
=======
> solidity-coverage: v0.8.2

Instrumenting for coverage...
=============================

> DAO.sol

Compilation:
============

Nothing to compile
No need to generate any newer typings.

Network Info
============
> HardhatEVM: v2.12.4
> network:    hardhat



  Common contract properties test
    ✔ Decimals test
    ✔ TotalSupply test
    ✔ Voting ttl test
    ✔ Proposal queue limit test
    ✔ Sample scenario balances test

  Proposal propagation test
    ✔ Propagate 1 proposal as non-holder -- revert
    ✔ Propagate 1 proposal
    ✔ Propagate 3 proposals (63ms)
    ✔ Propagate 4 proposals -- revert (70ms)
    ✔ Propagate 3 proposals & 1 after voting ttl expired (88ms)
    ✔ Two proposals with same message (39ms)

  Voting test
    ✔ A for, B for (43ms)
    ✔ A for, proposal expired, B for -- revert (43ms)
    ✔ A for, B for, C against -- revert (51ms)
    ✔ A for, proposal expired, check queued amount
    ✔ A against, B for, C against (all three votes are needed) (52ms)
    ✔ Vote ABSTAIN -- revert
    ✔ Vote as non-handler -- revert
    ✔ Vote second time differently: for -> against (41ms)
    ✔ Vote second time differently: against -> for (42ms)
    ✔ Vote second time the same way -- revert (40ms)

  Transfer test
    ✔ A for, B against, A -> D all tokens, D against (79ms)
    ✔ A -> B all tokens -- revert
    ✔ B for, C against, A -> D 10 tokens, D for, A for, accepted (99ms)
    ✔ A against, C for, A -> D 10 token, B against, declined (85ms)
    ✔ A for, C against, A -> D all tokens, D -> A all tokens, A for, B for, accepted (128ms)
    ✔ A against, C for, A -> D all tokens, D -> A all tokens, A against, B against, declined (126ms)


  27 passing (4s)

------------|----------|----------|----------|----------|----------------|
File        |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
------------|----------|----------|----------|----------|----------------|
 contracts/ |      100 |    89.13 |      100 |      100 |                |
  DAO.sol   |      100 |    89.13 |      100 |      100 |                |
------------|----------|----------|----------|----------|----------------|
All files   |      100 |    89.13 |      100 |      100 |                |
------------|----------|----------|----------|----------|----------------|
```


## Requirements

- Write simple voting contract and cover with tests
- Description
    - A pack of contracts that allows users to vote for proposals, using token balances. Users own an ERC20 token, representing “voting power” or DAO ownership shares. Proposals are simply the keccak256 hashes and can be “accepted”, “rejected” or “discarded” (if TTL of proposal is expired). The fact of acceptance of a proposal is fixed in the event, nothing else is stored in contracts.
- User story
    - A,B,C have 25, 40 and 35 voting tokens of total 100. “A “creates a proposal (text document, having hash) and publishes this hash in contract, voting with her 25 tokens “for” it. Then B also votes “yes” with his 40 tokens. So, 25+40 > 50% of total votes (100), proposal is accepted: event is fired, proposal is removed from queue. Same situation with proposals when > 50% of “no” votes is gathered. If a proposal stays in an indefinite state (no threshold votes gathered) until TTL expires, it cannot be “accepted” or “declined” and will be thrown away with “discarded” status next time when a new proposal is created.
    - [NOTE] business logic can slightly differ in your implementation if needed
- Requirements
    - Business logic requirements:
        - During creation totalSupply = 100.000000 (decimals = 6) tokens are minted to contract owner
        - Any owner of voting tokens can create a proposal, time-to-live(TTL) of proposal is 3 days, after that time proposal becomes “discarded” if not enough votes are gathered
        - Votes can be “for” or ”against” the proposal. Proposal becomes “accepted” or “declined” completed if > 50% of votes for the same decision (“for” or “against”) is gathered
        - When votes threshold is reached, event is emitted and proposal is removed from queue
        - There are no more than N=3 current proposals, new proposals cannot be added until old ones will be “accepted”, “declined” or “discarded” by TTL
        - If > 1 old proposals are obsolete, then addition of a new proposal automatically “kicks out” the most obsolete proposal, making it “discarded”.
        - voting should not “freeze” tokens
        - but, voting should handle a situation, when voter transfers his tokens to another address and votes another time
- Contracts requirements
    - Contracts should be written in Solidity
    - Contracts should follow official Solidity style guide
    - All functions should contain good comments
    - Functions should optimally use gas
    - Functions should contain checks to disallow possibility of contract DoS
    - Contracts should contain “view” functions, useful for building DApp for this voting
    - Project requirements
        - Project should be built using Hardhat or Brownie framework
        - Tests should cover all normal workflows of voting
        - Tests should cover EACH condition, leading to revert
        - Project should contain README.md with instructions how to build and run tests on Ubuntu 20.04+
