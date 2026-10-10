package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator

class MultiCarryTest {
    private fun identity() = LabCrypto(KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair())
    @Test fun `two carriers store restart forward once and carry receipt back`() {
        val a = identity(); val b = identity(); val c = identity(); val d = identity()
        val all = listOf(a,b,c,d).associateBy { it.deviceId }
        var now = 1800000000000L
        val disk = mutableMapOf<String,List<ByteArray>>()
        val writes = mutableListOf<Triple<String,String,ByteArray>>()
        val delivered = mutableListOf<String>()
        fun node(key: LabCrypto) = MeshEngine(key, { now }, { peer ->
            (key.deviceId == a.deviceId && peer == d.deviceId) || (key.deviceId == d.deviceId && peer == a.deviceId)
        }, { peer, bytes -> writes.add(Triple(key.deviceId,peer,bytes)) }, {}, { _, text -> delivered.add(text) }, saveCarry = { disk[key.deviceId] = it }).apply {
            carryPeer = { all[it]?.deviceId }; carryVersion = { 3 }
        }
        val source = node(a); source.linkUp(b.deviceId)
        source.send(d.publicKey,"multi carry",automatic=true)
        val first = writes.removeAt(0).third
        assertEquals(3,PacketCodec.decode(first).version)
        node(b).receive(a.deviceId,first)
        assertTrue(writes.isEmpty()) // no onward connection
        now += 60000
        val relayB = node(b); relayB.restoreCarry(disk.getValue(b.deviceId)); relayB.linkUp(c.deviceId)
        val second = writes.removeAt(0).third
        assertEquals(listOf(b.deviceId,c.deviceId),PacketCodec.decode(second).grants.map { it.target })
        val relayC = node(c); relayC.receive(b.deviceId,second); relayC.linkUp(d.deviceId)
        val third = writes.removeAt(0).third
        val final = node(d); final.receive(c.deviceId,third); final.receive(c.deviceId,third)
        assertEquals(listOf("multi carry"),delivered)
        assertEquals(4,PacketCodec.decode(third).remainingHops)
        assertThrows(Exception::class.java) { b.decrypt(PacketCodec.decode(second)) }
        // B cannot choose a different successor after losing C or restarting.
        val restoredB = node(b); restoredB.restoreCarry(disk.getValue(b.deviceId)); restoredB.linkUp(a.deviceId)
        assertTrue(writes.isEmpty())
        // The destination can return a separately encrypted receipt along the reverse path.
        final.linkUp(c.deviceId)
        val ack = ChatContent("A", java.util.UUID.randomUUID().toString()).encode()
        final.send(a.publicKey,ack,urgent=true,automatic=true,returnVia=listOf(c.deviceId,b.deviceId))
        val replyC = node(c); replyC.receive(d.deviceId,writes.removeAt(0).third); replyC.linkUp(b.deviceId)
        val replyB = node(b); replyB.receive(c.deviceId,writes.removeAt(0).third); replyB.linkUp(a.deviceId)
        source.receive(b.deviceId,writes.removeAt(0).third)
        assertEquals(listOf("multi carry",ack),delivered)
        now += CARRY_LIFETIME_MS; replyB.tick(); assertTrue(disk.getValue(b.deviceId).isEmpty())
    }
    @Test fun `grant tampering loops budget and disk failure fail closed`() {
        val a=identity(); val b=identity(); val c=identity(); val d=identity(); val e=identity()
        val now=1800000000000L
        val packet=a.encrypt(e.publicKey,"bounded",now,automatic=true,multiCarry=true)
        val ab=a.delegate(packet,b.deviceId)
        val abc=b.delegate(ab,c.deviceId)
        val abcd=c.delegate(abc,d.deviceId)
        assertTrue(LabCrypto.verify(PacketCodec.decode(PacketCodec.encode(abcd))))
        assertFalse(LabCrypto.verify(abc.copy(grants=abc.grants.reversed())))
        assertFalse(LabCrypto.verify(abc.copy(expiresAt=abc.expiresAt+1)))
        assertFalse(LabCrypto.verify(abc.copy(returnVia=listOf(d.deviceId))))
        assertFalse(LabCrypto.verify(abc.copy(grants=abc.grants.drop(1))))
        assertThrows(Exception::class.java) { b.delegate(ab,a.deviceId) }
        assertThrows(Exception::class.java) { d.delegate(abcd,identity().deviceId) }
        var fail=true; var saved=emptyList<ByteArray>(); var writes=0
        val relay=MeshEngine(b,{now},{false},{_,_-> writes++},{},{_,_->},saveCarry={if(fail) error("full") else saved=it}).apply { carryPeer={it}; carryVersion={3} }
        relay.linkUp(c.deviceId); relay.receive(a.deviceId,PacketCodec.encode(ab))
        assertEquals(0,writes); assertTrue(saved.isEmpty())
        fail=false; relay.receive(a.deviceId,PacketCodec.encode(ab))
        assertEquals(1,writes); assertEquals(2,PacketCodec.decode(saved.single()).grants.size)
        // Wrong transport identity cannot consume a valid grant.
        var badSaved=false
        val wrong=MeshEngine(c,{now},{false},{_,_->},{},{_,_->},saveCarry={badSaved=true}).apply {carryPeer={a.deviceId};carryVersion={3}}
        wrong.receive("pretend-b",PacketCodec.encode(abc.copy(remainingHops=5)))
        assertFalse(badSaved)
    }
    @Test fun `committed grant survives a failed handoff and restart without reassignment`() {
        val a=identity(); val b=identity(); val c=identity(); val d=identity()
        val now=1800000000000L; var disk=emptyList<ByteArray>(); var failCommit=false; var attempts=0
        fun source() = MeshEngine(a,{now},{true},{_,_-> attempts++; error("radio lost")},{},{_,_->},saveCarry={ if(failCommit) error("disk full") else disk=it }).apply {carryPeer={it};carryVersion={3}}
        val engine=source(); engine.send(d.publicKey,"keep grant",automatic=true)
        failCommit=true; engine.linkUp(b.deviceId)
        assertEquals(0,attempts); assertTrue(PacketCodec.decode(disk.single()).grants.isEmpty())
        failCommit=false; engine.tick()
        assertEquals(1,attempts); assertEquals(b.deviceId,PacketCodec.decode(disk.single()).grants.single().target)
        val restored=source(); restored.restoreCarry(disk); restored.linkUp(c.deviceId)
        assertEquals(1,attempts); assertEquals(b.deviceId,PacketCodec.decode(disk.single()).grants.single().target)
    }
    @Test fun `ordinary quota rejects extra envelope without losing retained copies`() {
        val a=identity(); val b=identity(); val now=1800000000000L
        var disk=emptyList<ByteArray>()
        val engine=MeshEngine(a,{now},{true},{_,_->},{},{_,_->},saveCarry={disk=it}).apply {carryVersion={3}}
        repeat(112) { engine.send(b.publicKey,"bounded $it",automatic=true) }
        assertThrows(Exception::class.java) { engine.send(b.publicKey,"overflow",automatic=true) }
        assertEquals(112,disk.size); assertTrue(disk.sumOf {it.size} <= 524288)
        engine.send(b.publicKey,ChatContent("A",java.util.UUID.randomUUID().toString()).encode(),urgent=true,automatic=true)
        assertEquals(113,disk.size) // urgent local receipt reserve remains usable
    }

    @Test fun `stale ready direct route cannot suppress two hop delivery through nonfriend`() {
        val a=identity(); val b=identity(); val c=identity()
        for (version in listOf(2,3)) {
            var now=1800000000000L
            val relayed=mutableListOf<ByteArray>(); val delivered=mutableListOf<String>()
            val source=MeshEngine(a,{now},{it==c.deviceId},{peer,frame->if(peer==b.deviceId) relayed.add(frame)},{},{_,_->},saveCarry={}).apply {carryPeer={it};carryVersion={version}}
            source.linkUp(c.deviceId); source.linkUp(b.deviceId)
            val id=source.send(c.publicKey,"two hops",automatic=true)
            assertTrue(relayed.isEmpty())
            now += 14999; source.tick(); assertTrue(relayed.isEmpty())
            now++; source.tick(); assertEquals(1,relayed.size)
            val receiver=MeshEngine(c,{now},{it==a.deviceId},{_,_->},{},{_,text->delivered.add(text)})
            val middle=MeshEngine(b,{now},{false},{_,frame->
                assertEquals(id,PacketCodec.decode(frame).id)
                assertEquals(5,PacketCodec.decode(frame).remainingHops)
                receiver.receive(b.deviceId,frame)
            },{},{_,_->error("Carrier must not decrypt")},saveCarry={}).apply {carryPeer={it};carryVersion={version}}
            middle.linkUp(c.deviceId); middle.receive(a.deviceId,relayed.single())
            assertEquals(listOf("two hops"),delivered)
        }
    }

}
