package org.loka.meshlab
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import org.loka.core.*
import org.json.JSONObject

class LocalCardStorageTest {
    @Test fun boundedSnapshotsRoundTripAndRejectExpiredOrChangedCatalogs(){
        val prefs=InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("loka-card-storage-test",0)
        val cards=(0 until 5).map{PartyCard("s$it","x","Question $it","clean",setOf("friends"),2,2,false)}
        val store=LocalCardStorage(prefs,cards);store.clear()
        try{
            val session=LocalCardSession(cards);session.configure(setOf("clean"),false,false,CardAudience(2,"friends"),listOf("Alex","Blair"),"all",1,true,false)
            session.reveal();session.advance(false,false);session.reveal();session.advance(false,false);session.newRound(false,false);session.reveal();session.advance(false,false);session.pause();store.save(session)
            val saved=store.load(cards,false,false)!!;val recovered=LocalCardSession(cards);recovered.restore(saved.first,false,false,saved.second);assertEquals(session.frame(),recovered.frame());assertEquals(1,recovered.roundIndex);assertNotNull(recovered.previous)
            val raw=JSONObject(prefs.getString("session",null)!!);raw.put("updated",System.currentTimeMillis()-86400001);prefs.edit().putString("session",raw.toString()).commit();assertNull(store.load(cards,false,false));assertFalse(prefs.contains("session"))
            store.save(session);val changed=cards.map{it.copy(text=it.text+" changed")};assertNull(LocalCardStorage(prefs,changed).load(changed,false,false));assertFalse(prefs.contains("session"))
        }finally{store.clear()}
    }
}
