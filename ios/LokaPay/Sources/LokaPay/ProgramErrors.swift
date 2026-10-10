import Foundation

/// The `loka_vault` program's named errors, so a failed CONF's signed error code (PAYMENT-V1
/// section 4.3) can be shown by name. Anchor numbers custom errors from 6000 in declaration order
/// (`programs/loka_vault/src/error.rs`); this table is `errors` in `programs/idl/loka_vault.json`,
/// and `ProgramErrorTableTests` compares the two, so they cannot drift apart unnoticed.
public enum LokaVaultError {
    /// The program refuses a note whose allowance serial was already redeemed: a reused serial,
    /// which is a double spend. The deliberate cheat (task 2.13) lands on chain with this code.
    public static let serialUsed: UInt16 = 6011

    public static let names: [UInt16: String] = [
        6000: "InvalidAuthority",
        6001: "BadSysvar",
        6002: "BadPrecompile",
        6003: "WrongMessage",
        6004: "PayerMismatch",
        6005: "InvalidNote",
        6006: "WrongProgram",
        6007: "WrongCluster",
        6008: "WrongMint",
        6009: "InvalidAllowance",
        6010: "InvalidMerchant",
        6011: "SerialUsed",
        6012: "CapExceeded",
        6013: "Expired",
        6014: "EarmarkDenied",
        6015: "Overflow",
        6016: "WithdrawalReplay",
        6017: "InsufficientBalance",
        6018: "BadDestination",
        6019: "InvalidPayerKey",
        6020: "InvalidEarmarks",
        6021: "InvalidLimits",
        6022: "InvalidMintDecimals",
    ]

    /// The program's name for `code`, or nil for a code it does not define.
    public static func name(code: UInt16) -> String? { names[code] }
}
