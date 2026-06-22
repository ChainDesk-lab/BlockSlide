// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy as OZErc1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Wrapper so Hardhat can compile and deploy the ERC1967Proxy
// Use this contract name when deploying via Hardhat scripts
contract ERC1967Proxy is OZErc1967Proxy {
    constructor(address implementation, bytes memory data)
        OZErc1967Proxy(implementation, data)
    {}
}
