import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.loka.core.QuickQuiz;

/** Persistent JVM peer for Swift/Kotlin application-event interoperability. */
public class GameInterop {
    public static void main(String[] args) throws Exception {
        List<String> sent = new ArrayList<>();
        String[] saved = {""};
        long[] clock = {1000000L};
        QuickQuiz game = new QuickQuiz(args[0], args[1], Arrays.asList(0,1,3,2,1,2,3,0,2,0),
            () -> clock[0], raw -> { saved[0] = raw; return kotlin.Unit.INSTANCE; },
            (peer,text) -> { sent.add(text); return UUID.randomUUID().toString(); }, id -> kotlin.Unit.INSTANCE);
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String line; (line = in.readLine()) != null;) {
            String[] p = line.split("\t", -1); sent.clear();
            try {
                switch (p[0]) {
                    case "invite": game.invite(p[1]); break;
                    case "accept": game.accept(); break;
                    case "answer": game.answer(Integer.parseInt(p[1])); break;
                    case "recv": game.receive(p[1], new String(Base64.getDecoder().decode(p[2]), StandardCharsets.UTF_8)); break;
                    case "resume": game.resume(); break;
                    case "restore": game.restore(saved[0]); break;
                    case "time": clock[0] = Long.parseLong(p[1]); game.tick(); break;
                    case "tick": game.tick(); break;
                    default: throw new Exception("unknown command");
                }
                List<String> output = new ArrayList<>();
                for (String text : sent) output.add(Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
                System.out.println("OK\t" + (game.getSession() == null ? -1 : game.getSession().getRevision()) + "\t" + game.getCanAnswer() + "\t" + Base64.getEncoder().encodeToString(game.export().getBytes(StandardCharsets.UTF_8)) + "\t" + String.join(",", output));
            } catch (Exception e) { System.out.println("ERR\t" + e.getClass().getSimpleName()); }
            System.out.flush();
        }
    }
}
