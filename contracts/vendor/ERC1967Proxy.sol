// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Thin wrapper so Hardhat generates a deployable artifact for Ignition.
contract Game2048Proxy is ERC1967Proxy {
    constructor(address implementation, bytes memory _data)
        ERC1967Proxy(implementation, _data)
    {}
}
