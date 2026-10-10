use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Only this program's current upgrade authority may initialize configuration")]
    InvalidAuthority,
    #[msg("The instructions sysvar must be canonical")]
    BadSysvar,
    #[msg("Expected the canonical adjacent single-signature P-256 precompile")]
    BadPrecompile,
    #[msg("The verified message differs from the canonical instruction message")]
    WrongMessage,
    #[msg("The verified public key differs from the registered key")]
    PayerMismatch,
    #[msg("Invalid signed prefix, currency or amount")]
    InvalidNote,
    #[msg("The signed program id does not match this program")]
    WrongProgram,
    #[msg("The signed cluster does not match the deployment")]
    WrongCluster,
    #[msg("The signed mint does not match the deployment")]
    WrongMint,
    #[msg("The allowance does not match the signed allowance id")]
    InvalidAllowance,
    #[msg("The merchant does not match the signed payee")]
    InvalidMerchant,
    #[msg("This allowance serial was already redeemed")]
    SerialUsed,
    #[msg("The cumulative redeemed amount would exceed the funded cap")]
    CapExceeded,
    #[msg("Expired allowance or note, or note expiry exceeds allowance expiry")]
    Expired,
    #[msg("The allowance does not permit this merchant")]
    EarmarkDenied,
    #[msg("Integer arithmetic overflow")]
    Overflow,
    #[msg("The withdrawal counter is not the current merchant counter")]
    WithdrawalReplay,
    #[msg("The withdrawal exceeds the merchant's credited balance")]
    InsufficientBalance,
    #[msg("The destination is not the signed wallet")]
    BadDestination,
    #[msg("Expected a compressed P-256 key prefix")]
    InvalidPayerKey,
    #[msg("Earmarks must be sorted, unique and at most sixteen")]
    InvalidEarmarks,
    #[msg("The cap must be positive and offline limit at most the cap")]
    InvalidLimits,
    #[msg("The configured token mint must have six decimals")]
    InvalidMintDecimals,
}
