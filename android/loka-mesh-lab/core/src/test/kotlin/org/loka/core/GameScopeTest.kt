package org.loka.core

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class GameScopeTest {
    @Test fun completeNonContactHandshakeUsesPublishedSessionWithoutChatPermission() {
        val gen=java.security.KeyPairGenerator.getInstance("RSA").apply{initialize(3072)}
        val crypto=List(2){LabCrypto(gen.generateKeyPair())};val now=1800000000000L;val hash="f".repeat(64)
        val ids=crypto.map{it.deviceId};val frames=ArrayDeque<Triple<Int,Int,ByteArray>>()
        val errors=mutableListOf<String>()
        val published=arrayOfNulls<PartySession>(2);val games=mutableListOf<PartyCards>();val nodes=mutableListOf<MeshEngine>()
        repeat(2){ i ->
            val mesh=MeshEngine(crypto[i],{now},{false},{_,raw->frames.add(Triple(i,1-i,raw))},{errors.add(it)},{sender,text->games[i].receive(sender,text);published[i]=games[i].session},saveCarry={})
            mesh.applicationPeer={it==ids[1-i]}
            mesh.applicationContent={sender,text->PartyEvent.permitted(sender,text,hash,published[i],now)}
            mesh.carryPeer={ids[1-i]};mesh.carryVersion={2};mesh.linkUp("peer");nodes.add(mesh)
            val card=PartyCard("card","never_have_i_ever","Public prompt","clean",setOf("friends"),2,2,false)
            games.add(PartyCards(ids[i],hash,listOf(card),{now},{},{peer,text->mesh.send(crypto[ids.indexOf(peer)].publicKey,text,automatic=true,lifetimeMs=120000)},{id->mesh.discard(listOf(id))}))
        }
        fun drain(){var count=0;while(frames.isNotEmpty()){check(++count<100);val (_,to,raw)=frames.removeFirst();nodes[to].receive("peer",raw)}}
        games[0].invite(listOf(ids[1]),PartySettings("never_have_i_ever","friends"));published[0]=games[0].session;drain()
        assertNotNull(errors.joinToString("\n"),games[1].session);assertEquals("invited",games[1].session!!.phase);games[1].accept();published[1]=games[1].session;drain()
        assertTrue(games[0].canAct);games[0].act("done");published[0]=games[0].session;drain()
        assertEquals(1,games[1].session!!.revision)
        try { nodes[0].send(crypto[1].publicKey,"chat");fail() } catch (_:IllegalArgumentException) {}
    }
    @Test fun acceptedCardActionsUseExistingCiphertextRelayWithoutChatTrust() {
        val gen=java.security.KeyPairGenerator.getInstance("RSA").apply{initialize(3072)}
        val crypto=List(3){LabCrypto(gen.generateKeyPair())};val now=1800000000000L;val hash="f".repeat(64)
        val ids=crypto.map{it.deviceId};val frames=ArrayDeque<Triple<Int,Int,ByteArray>>()
        val published=arrayOfNulls<PartySession>(3);val games=mutableMapOf<Int,PartyCards>();var relayApplications=0
        val nodes=crypto.mapIndexed { i,key ->
            MeshEngine(key,{now},{false},{peer,raw->frames.add(Triple(i,peer.toInt(),raw))},{},{sender,text->
                if(i==1)relayApplications++ else {games.getValue(i).receive(sender,text);published[i]=games.getValue(i).session}
            },saveCarry={})
        }
        nodes.forEachIndexed { i,node ->
            node.carryPeer={ids[it.toInt()]};node.carryVersion={2}
            if(i!=1){node.applicationPeer={it==ids[2-i]};node.applicationContent={sender,text->PartyEvent.permitted(sender,text,hash,published[i],now)}
                val card=PartyCard("card","never_have_i_ever","Public prompt","clean",setOf("friends"),2,2,false)
                games[i]=PartyCards(ids[i],hash,listOf(card),{now},{},{peer,text->node.send(crypto[ids.indexOf(peer)].publicKey,text,automatic=true,lifetimeMs=120000)},{id->node.discard(listOf(id))})
            }
        }
        nodes[0].linkUp("1");nodes[1].linkUp("0");nodes[1].linkUp("2");nodes[2].linkUp("1")
        fun drain(){var count=0;while(frames.isNotEmpty()){check(++count<150);val (from,to,raw)=frames.removeFirst();val packet=PacketCodec.decode(raw);assertFalse(String(packet.ciphertext).contains("L1|G|"));assertThrows(IllegalArgumentException::class.java){crypto[1].decrypt(packet)};nodes[to].receive(from.toString(),raw)}}
        games.getValue(0).invite(listOf(ids[2]),PartySettings("never_have_i_ever","friends"));published[0]=games.getValue(0).session;drain()
        assertEquals("invited",games.getValue(2).session!!.phase);games.getValue(2).accept();published[2]=games.getValue(2).session;drain()
        games.getValue(0).act("done");published[0]=games.getValue(0).session;drain()
        assertEquals(1,games.getValue(2).session!!.revision);assertEquals(0,relayApplications)
    }
    @Test fun nonContactGamePermitDoesNotAuthorizeChatOrUnknownPeers() {
        val a=LabCrypto(java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair());val b=LabCrypto(java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair());val now=System.currentTimeMillis();val pack="f".repeat(64)
        val text=PartyEvent("C",UUID.randomUUID().toString(),UUID.randomUUID().toString(),pack,now+120000).encode()
        val accepted=mutableListOf<String>();val errors=mutableListOf<String>()
        val node=MeshEngine(b,{now},{false},{_,_->},{errors.add(it)},{_,body->accepted.add(body)})
        val packet=a.encrypt(b.publicKey,text,now)
        node.receive("lab",PacketCodec.encode(packet));assertTrue(accepted.isEmpty())
        node.applicationPeer={it==a.deviceId}
        node.applicationContent={id,raw->id==a.deviceId && runCatching{PartyEvent.decode(raw).pack==pack}.getOrDefault(false)}
        node.receive("lab",PacketCodec.encode(packet));assertEquals(listOf(text),accepted)
        val chat=a.encrypt(b.publicKey,"private chat",now)
        node.receive("lab",PacketCodec.encode(chat));assertEquals(1,accepted.size)
        val bad=a.encrypt(b.publicKey,text.replace("L1|G|2|","L1|G|9|"),now)
        node.receive("lab",PacketCodec.encode(bad));assertEquals(1,accepted.size)
        val other=LabCrypto(java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair());node.receive("lab",PacketCodec.encode(other.encrypt(b.publicKey,text,now)));assertEquals(1,accepted.size)
        try{node.send(a.publicKey,"chat from a game");fail()}catch(_:IllegalArgumentException){}
        node.send(a.publicKey,text)
        val reply=b.encrypt(a.publicKey,text,now)
        try{node.restore(PacketCodec.encode(reply));fail()}catch(_:IllegalArgumentException){}
        node.applicationPacket={it.id==reply.id && it.destination==a.deviceId}
        node.restore(PacketCodec.encode(reply))
        assertTrue(errors.any{it.contains("Dropped") || it.contains("Reject") || it.contains("reject")})
    }
}
