#if DEBUG
import CryptoKit
import Foundation

/// PREVIEW ONLY. Copied from protocol/vectors/payment-v1.json: the vector deployment, the vector
/// server key, and certificates, notes and acks made with keys derived from public labels. They
/// verify only against the vector deployment and vector server key (never against
/// config/pins.json), this file is compiled in Debug builds only, and nothing outside the #Preview
/// blocks reads it. A test checks that every fixture still verifies, so a preview never shows an
/// error state by accident.
enum PreviewFixtures {
    static let programIdHex = "f0cf4534b0533c61fcb9d16f5dfb4ce3a7ac85b5b39a6e67bef0f862cb59d1f5"
    static let mintHex = "3b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea7"
    static let serverEd25519Hex = "263e59e39c3498da843eb22a8ca884e716bf2d0c4a9ca1573781e4ae27436762"
    static let allowanceHex = "4c4f4b412d5041592d414c4c572d5631f0cf4534b0533c61fcb9d16f5dfb4ce3a7ac85b5b39a6e67bef0f862cb59d1f5003b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea700000000000003e9b73cfc5a01d7a1cca3e0d6da89967795d0b30588192a8943c3d266eafedf73df00000000004c4b4000000000002dc6c00000000070dbd88096a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7000000000007a12072c6ad27d9a1383ea9a238c9e1b0435cb787fff2228d72793bc07888d197b777fb46ae065e21f6f6b3ae7d0be72e646b8414dac501edb39923e909ea1b10d6060000"
    static let merchantHex = "4c4f4b412d5041592d4d5243482d5631f0cf4534b0533c61fcb9d16f5dfb4ce3a7ac85b5b39a6e67bef0f862cb59d1f5003b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea73f895a02c4c680bb5f2db66fc95e1b7d9ab3a2a4b26b0242b204cf6c98ca8092001243616d70757320436f6666656520436172744389525c5b143cd1abb28987b54461e99eafd7bfd0bc52e347dbbb212ec82ec7ea765d82942c66d11ae544c5c53503e2e50fd58f0f75bcc2495126aaa680f207"
    static let note0Hex = "4c4f4b412d5041592d4e4f54452d5631f0cf4534b0533c61fcb9d16f5dfb4ce3a7ac85b5b39a6e67bef0f862cb59d1f5003b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea700000000000003e93f895a02c4c680bb5f2db66fc95e1b7d9ab3a2a4b26b0242b204cf6c98ca809200000000000f4240555344000000000070dbd8807fbd4210001dc45cc44b1501d0e5ad5a6da82344d17468129aa72deef87dfbc93d46cee4b77525e5bd8c536a293bce4f20ae2bcb968216a273f43190ab4148cd0203c08864949467f7fa01f08c4923cc9fa4e7feacfdb32099c43d8de657a17cc6"
    static let note1Hex = "4c4f4b412d5041592d4e4f54452d5631f0cf4534b0533c61fcb9d16f5dfb4ce3a7ac85b5b39a6e67bef0f862cb59d1f5003b442cb3912157f13a933d0134282d032b5ffecd01a2dbf1b7790608df002ea700000000000003e93f895a02c4c680bb5f2db66fc95e1b7d9ab3a2a4b26b0242b204cf6c98ca8092000000000003d090555344010000000070dbd880cc639d7e52c7d89b2ea87c8cd56185d74c83ab6b4184fd29daadce8db0ecc07c5fdbbe9f67cd42a2a052e6be6b49486ee0606a5522df65a09de94d7a60e55ab00203c08864949467f7fa01f08c4923cc9fa4e7feacfdb32099c43d8de657a17cc6"
    static let ackHex = "4c4f4b412d5041592d41434b4e2d5631c7b0be30f29587bb1a89a178694ae7acf41a7583269eb128d845f5ad84dab69b000000006ac980007600c01833e85a1b6e4b616e6f2277923672bbe5ab0ac768bfcdbdd6caef4b3527581dfa17e3f95e284a4f1aaa3925a9f4a03cafb4c2484d0dd67459f15022ab02ff58973549d33cb4d43db675796924170bb44d409451e34cb227fbd1a8ccda4d"
    static let confSettledHex = "4c4f4b412d5041592d434f4e462d5631c7b0be30f29587bb1a89a178694ae7acf41a7583269eb128d845f5ad84dab69b3c6c473ad6f5a8fcb6923f636287f66508cca53364707d6a4dd76d36868ce79b91cf6339ef75708f64ecf6fe39c049ba25c4ccc1a2d658addf9ba284464dd067000000001893e54e000000006ac98003000000006ac98001010000b55a0b82607217f044849815433b90bcba90b8a08123bdc1d40c59fd412eb02cf1acea8334af55769c0e60548b49cf241023241b003a554e28c494550ac44302"
    static let confFailedHex = "4c4f4b412d5041592d434f4e462d5631c7b0be30f29587bb1a89a178694ae7acf41a7583269eb128d845f5ad84dab69b125ed937c2c2127f6e1d69be05617b4ab094dea3747196f1f0236f0af933f77772a2962bc6dada3038c71dd44f2956a98e906fe298dd03653aa45f5e32f395f8000000001893e68f000000006ac98064000000006ac98062021771042505e4cee06d2fec5d1caf7b2657ea0583931a022093947d4e38f59b59acec5217b78a5b2750068d0051a7648f6dfed2c7ecf744b1c2dcf5fa9ebaaff53b07"

    static let deployment = Deployment(programId: Data(hex: programIdHex)!, clusterId: 0, mint: Data(hex: mintHex)!)
    static let serverKey = Data(hex: serverEd25519Hex)!
    static let allowanceWire = Data(hex: allowanceHex)!
    static let merchantWire = Data(hex: merchantHex)!
    static let note0Wire = Data(hex: note0Hex)!
    static let note1Wire = Data(hex: note1Hex)!
    static let ackWire = Data(hex: ackHex)!
    static let confSettledWire = Data(hex: confSettledHex)!
    static let confFailedWire = Data(hex: confFailedHex)!

    /// The vector ack's received-at, and 42 seconds later, so the offline clock reads 0:42.
    static let receivedAt = Date(timeIntervalSince1970: 1_791_590_400)
    static let now = Date(timeIntervalSince1970: 1_791_590_442)

    static let payerSigner = SoftwareP256Signer(privateKey: vectorKey("payer"))
    static let merchantSigner = SoftwareP256Signer(privateKey: vectorKey("merchant-a"))

    /// The vectors' P-256 derivation (tools/vectors/gen.mjs): secret = (sha256(label) mod (n - 1)) + 1.
    static func vectorKey(_ name: String) -> P256.Signing.PrivateKey {
        var digest = Data(SHA256.hash(data: Data("LOKA-PAY-V1 test key \(name)".utf8)))
        let orderMinusOne = Data(hex: "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550")!
        if P256Rules.compare(digest, orderMinusOne) >= 0 { digest = P256Rules.subtract(digest, orderMinusOne) }
        var bytes = [UInt8](digest)
        var i = 31
        while bytes[i] == 0xff {
            bytes[i] = 0
            i -= 1
        }
        bytes[i] += 1
        return try! P256.Signing.PrivateKey(rawRepresentation: Data(bytes))
    }

    static var allowance: AllowanceCertificate {
        try! AllowanceCertificate.verify(wire: allowanceWire, deployment: deployment, serverPublicKey: serverKey)
    }

    static var merchant: MerchantCertificate {
        try! MerchantCertificate.verify(wire: merchantWire, deployment: deployment, serverPublicKey: serverKey)
    }

    static var note0: SignedNote { try! SignedNote.validate(wire: note0Wire, deployment: deployment) }
    static var ack0: Ack { try! Ack.verify(wire: ackWire, for: note0) }

    static func receipt(conf: Data?) -> VerifiedReceipt {
        try! Receipts.verify(Bundles.receipt(note: note0, ack: ack0, confirmationWire: conf),
                             deployment: deployment, serverPublicKey: serverKey)
    }

    static var payment: SignedPayment {
        SignedPayment(note: note0, allowanceText: PaymentTransport.encode(.allowance, allowanceWire),
                      noteText: PaymentTransport.encode(.note, note0Wire))
    }

    static func received(withAck: Bool = true) -> ReceivedPayment {
        ReceivedPayment(note: note0, certificate: allowance, receivedAt: receivedAt, receivedWithZeroBars: true,
                        ack: withAck ? ack0 : nil)
    }

    static func settled(conf: Data) -> SettledPayment {
        let bytes = Bundles.receipt(note: note0, ack: ack0, confirmationWire: conf)
        return SettledPayment(receipt: receipt(conf: conf), receiptText: PaymentTransport.encode(.receipt, bytes),
                              replayed: false, reasonUnsigned: nil)
    }

    static func scratchURL(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("lokapay-previews", isDirectory: true)
            .appendingPathComponent(name)
    }
}
#endif
