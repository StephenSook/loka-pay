import java.nio.file.*;
import java.security.*;
import java.security.spec.*;
import org.loka.core.*;
import kotlin.Unit;

/** Calls the actual Android core. Only fresh ephemeral test keys may be stored in its temporary directory. */
public final class JavaInterop {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("nearby-session")) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(3072);
            LabCrypto crypto = new LabCrypto(generator.generateKeyPair());
            java.util.List<NearbyProfile> profiles = new java.util.ArrayList<>();
            java.util.List<ContactConsentBook.Entry> entries = new java.util.ArrayList<>();
            java.util.Set<String> trusted = new java.util.HashSet<>();
            NearbyPeople people = new NearbyPeople(crypto, () -> "Android Test", () -> true,
                (handle,frame) -> { System.out.println("FRAME " + java.util.Base64.getEncoder().encodeToString(frame)); return Unit.INSTANCE; },
                state -> Unit.INSTANCE, (key,name) -> { trusted.add(java.util.Base64.getEncoder().encodeToString(key)); return Unit.INSTANCE; },
                (p,r) -> { profiles.clear(); profiles.addAll(p); entries.clear(); entries.addAll(r); return Unit.INSTANCE; }, System::currentTimeMillis, () -> "avatar_41");
            long[] typing = new long[1];
            people.setTrusted(id -> !trusted.isEmpty() && profiles.stream().anyMatch(p -> p.getId().equals(id)));
            people.setTypingChanged((id,until) -> { typing[0]=until; return Unit.INSTANCE; });
            people.restore(null);
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
            for (String line; (line=reader.readLine()) != null;) {
                if (line.equals("QUIT")) break;
                if (line.equals("LINK")) people.link("direct",true);
                else if (line.startsWith("FRAME ")) people.receive("direct",java.util.Base64.getDecoder().decode(line.substring(6)));
                else if (line.equals("REQUEST")) people.request(profiles.get(0).getId());
                else if (line.equals("ACCEPT")) people.decide(entries.get(0).getRequest().getId(),true);
                else if (line.equals("TYPE1")) people.typing(profiles.get(0).getId(),true);
                else if (line.equals("TYPE0")) people.typing(profiles.get(0).getId(),false);
                else if (line.equals("TYPING")) System.out.println("TYPING " + (typing[0] > System.currentTimeMillis()));
                else if (line.equals("AVATAR")) System.out.println("AVATAR " + profiles.get(0).getAvatarID());
                else if (line.equals("STATE")) System.out.println("STATE " + trusted.size() + " " + profiles.get(0).getName());
                System.out.println("END"); System.out.flush();
            }
            return;
        }
        Path dir = Path.of(args[1]);
        if (args[0].equals("generate")) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(3072);
            KeyPair pair = generator.generateKeyPair();
            Files.write(dir.resolve("java-private.der"), pair.getPrivate().getEncoded());
            Files.write(dir.resolve("java-public.der"), pair.getPublic().getEncoded());
            LabCrypto crypto = new LabCrypto(pair);
            Packet packet = crypto.encrypt(Files.readAllBytes(dir.resolve("swift-public.der")), "Hello iPhone 👋 café", System.currentTimeMillis());
            Files.write(dir.resolve("java-packet.bin"), PacketCodec.INSTANCE.encode(packet));
        } else {
            KeyFactory factory = KeyFactory.getInstance("RSA");
            KeyPair pair = new KeyPair(factory.generatePublic(new X509EncodedKeySpec(Files.readAllBytes(dir.resolve("java-public.der")))),
                factory.generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(dir.resolve("java-private.der")))));
            LabCrypto crypto = new LabCrypto(pair);
            if (args[0].equals("multi-forward")) {
                byte[] incoming = Files.readAllBytes(dir.resolve("multi-in.bin"));
                String from = args[2], next = args[3];
                java.util.List<byte[]> saved = new java.util.ArrayList<>();
                byte[][] output = new byte[1][];
                MeshEngine first = new MeshEngine(crypto, System::currentTimeMillis, id -> false,
                    (peer, frame) -> { throw new AssertionError("No live route before restart"); }, event -> Unit.INSTANCE,
                    (id, text) -> { throw new AssertionError("Carrier decrypted"); }, null, null,
                    frames -> { saved.clear(); saved.addAll(frames); return Unit.INSTANCE; });
                first.setCarryPeer(handle -> handle); first.setCarryVersion(id -> 3);
                first.receive(from, incoming);
                if (saved.size() != 1) throw new AssertionError("Not retained");
                MeshEngine restored = new MeshEngine(crypto, System::currentTimeMillis, id -> false,
                    (peer, frame) -> { output[0] = frame; return Unit.INSTANCE; }, event -> Unit.INSTANCE,
                    (id, text) -> { throw new AssertionError("Carrier decrypted"); }, null, null,
                    frames -> Unit.INSTANCE);
                restored.setCarryPeer(handle -> handle); restored.setCarryVersion(id -> 3);
                restored.restoreCarry(saved); restored.linkUp(next);
                if (output[0] == null) throw new AssertionError("No onward frame");
                Files.write(dir.resolve("multi-out.bin"), output[0]); return;
            }
            if ((args[0].equals("carry-check") || args[0].equals("auto-carry-check"))) {
                long now = Long.parseLong(args[2]);
                Packet packet = PacketCodec.INSTANCE.decode(Files.readAllBytes(dir.resolve("swift-carry.bin")));
                packet.validate(now);
                if (packet.getVersion() != (args[0].equals("auto-carry-check") ? 2 : 1) || packet.getRemainingHops() != 5 || !LabCrypto.Companion.verify(packet) || !crypto.decrypt(packet).equals("Carry interoperability")) throw new AssertionError("Carry mismatch");
                Packet receipt = crypto.encrypt(packet.getSenderPublicKey(), "Carry receipt", now, packet.getCarrier(), packet.getVersion() == 2);
                Files.write(dir.resolve("java-carry-receipt.bin"), PacketCodec.INSTANCE.encode(receipt));
                return;
            }
            if (args[0].startsWith("consent-")) {
                long now = System.currentTimeMillis();
                Packet requestPacket = PacketCodec.INSTANCE.decode(Files.readAllBytes(dir.resolve("consent-request.bin")));
                requestPacket.validate(now);
                ContactConsent request = ContactConsent.Companion.decode(crypto.decrypt(requestPacket));
                ContactConsentBook book = new ContactConsentBook(crypto.getDeviceId());
                book.receive(requestPacket.getSource(), request, now);
                if (book.snapshot(now).get(0).getPhase() != ContactConsentBook.Phase.INCOMING)
                    throw new AssertionError("Request must await explicit approval");
                ContactConsent accept = book.decide(request.getId(), true, "Android Test", now);
                if (args[0].equals("consent-accept")) {
                    Packet response = crypto.encrypt(requestPacket.getSenderPublicKey(), accept.encode(), now);
                    Files.write(dir.resolve("consent-accept.bin"), PacketCodec.INSTANCE.encode(response));
                } else {
                    Packet ackPacket = PacketCodec.INSTANCE.decode(Files.readAllBytes(dir.resolve("consent-ack.bin")));
                    ackPacket.validate(now);
                    ContactConsent ack = ContactConsent.Companion.decode(crypto.decrypt(ackPacket));
                    book.receive(ackPacket.getSource(), ack, now);
                    if (book.snapshot(now).get(0).getPhase() != ContactConsentBook.Phase.COMPLETE)
                        throw new AssertionError("Encrypted cross-platform consent failed");
                }
                System.out.println("Java encrypted consent step passed");
                return;
            }
            Packet packet = PacketCodec.INSTANCE.decode(Files.readAllBytes(dir.resolve("swift-packet.bin")));
            packet.validate(System.currentTimeMillis());
            if (!crypto.decrypt(packet).equals("Hello Android 👋 café")) throw new AssertionError("Swift → Java plaintext mismatch");
            // A Swift-origin packet follows the actual Android ciphertext-only relay path.
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(3072);
            byte[][] forwarded = new byte[1][];
            MeshEngine relay = new MeshEngine(new LabCrypto(generator.generateKeyPair()), System::currentTimeMillis,
                id -> false, (peer, frame) -> { forwarded[0] = frame; return Unit.INSTANCE; },
                event -> Unit.INSTANCE, (id, text) -> { throw new AssertionError("Relay decrypted a message"); });
            relay.linkUp("destination");
            relay.receive("origin", Files.readAllBytes(dir.resolve("swift-packet.bin")));
            if (forwarded[0] == null || PacketCodec.INSTANCE.decode(forwarded[0]).getRemainingHops() != packet.getRemainingHops() - 1)
                throw new AssertionError("Android did not forward Swift ciphertext with decremented budget");
            String[] delivered = new String[1]; int[] count = new int[1];
            MeshEngine receiver = new MeshEngine(crypto, System::currentTimeMillis, id -> id.equals(packet.getSource()),
                (peer, frame) -> Unit.INSTANCE, event -> Unit.INSTANCE,
                (id, text) -> { delivered[0] = text; count[0]++; return Unit.INSTANCE; });
            receiver.receive("relay", forwarded[0]); receiver.receive("relay", forwarded[0]);
            if (count[0] != 1 || !"Hello Android 👋 café".equals(delivered[0])) throw new AssertionError("Relayed delivery/deduplication failed");
        }
        System.out.println("Java interoperability step passed");
    }
}
