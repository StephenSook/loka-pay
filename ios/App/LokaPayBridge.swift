import LokaPay

/// App-side entry point to the LokaPay package (ios/LokaPay, tasks 1.5 and 1.10).
/// Payment logic stays in the package (D7); this file keeps the app glue small.
enum LokaPayBridge {
    /// True when this device can hold a Secure Enclave payment key.
    static var secureEnclaveAvailable: Bool { SecureEnclaveP256Signer.isAvailable }
}
