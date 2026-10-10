import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.loka.core.*;
public class PartyInterop {
    public static void main(String[] args) throws Exception {
        List<String> sent=new ArrayList<>();String[] saved={""};long[] clock={1000000L};
        List<PartyCard> cards=new ArrayList<>();for(int i=0;i<8;i++)cards.add(new PartyCard("card_"+i,"never_have_i_ever","Prompt "+i,"clean",Set.of("group","friends","couples"),2,20,false));
        PartyCards game=new PartyCards(args[0],args[1],cards,()->clock[0],raw->{saved[0]=raw;return kotlin.Unit.INSTANCE;},(peer,text)->{sent.add(peer+"#"+Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));return UUID.randomUUID().toString();},id->kotlin.Unit.INSTANCE);
        BufferedReader in=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
        for(String line;(line=in.readLine())!=null;) {
            String[] p=line.split("\t",-1);sent.clear();
            try {
                switch(p[0]) {
                    case "invite":game.invite(Arrays.asList(p[1].split(",")),new PartySettings("never_have_i_ever","group","clean",false,false));break;
                    case "accept":game.accept();break;
                    case "act":game.act(p[1]);break;
                    case "recv":game.receive(p[1],new String(Base64.getDecoder().decode(p[2]),StandardCharsets.UTF_8));break;
                    case "resume":game.resume();break;
                    case "restore":game.restore(saved[0]);break;
                    case "time":clock[0]=Long.parseLong(p[1]);game.tick();break;
                    case "tick":game.tick();break;
                    default:throw new Exception("Unknown command");
                }
                System.out.println("OK\t"+(game.getSession()==null?-1:game.getSession().getRevision())+"\t"+(game.getCurrent()==null?"-":game.getCurrent().getId())+"\t"+Base64.getEncoder().encodeToString(game.export().getBytes(StandardCharsets.UTF_8))+"\t"+String.join(",",sent));
            }catch(Exception e){System.out.println("ERR\t"+e.getClass().getSimpleName());}
            System.out.flush();
        }
    }
}
