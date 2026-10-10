#!/usr/bin/env python3
"""Validate bundled party metadata separately from the untimed quiz pack."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'gameJson/games.json').read_text())
games = catalog['games']
assert len(games) == catalog['meta']['totalGames'] >= 1
cards = [c for g in games for c in g['cards']]
assert len(cards) == catalog['meta']['totalCards']
assert len({g['id'] for g in games}) == len(games)
assert len({c['id'] for c in cards}) == len(cards)
for game in games:
    assert 2 <= game['minPlayers'] <= game['maxPlayers'] <= 20
    assert game['cardCount'] == len(game['cards'])
    for card in game['cards']:
        assert game['minPlayers'] <= card['minPlayers'] <= card['maxPlayers'] <= game['maxPlayers']
        assert set(card['supportedModes']) <= set(game['supportedModes']) <= {'couples', 'friends', 'group'}
        assert card['intensity'] in game['intensityLevels']
        assert isinstance(card['text'], str) and card['text']
        assert isinstance(card['requiresConsent'], bool)
        assert card['packs'] and set(card['packs']) <= {'classic','new_friends','close_friends','couples','family','big_party'}
        assert card['stage'] in (0,1,2)
        if 'family' in card['packs']:
            assert card['tags'] == ['clean'] and not card['requiresAdult'] and not card['requiresDrinking']
        if card.get('namedText'):
            assert '{player}' in card['namedText'] and '{partner}' in card['namedText']
            assert card['namedText'].replace('{player}','').replace('{partner}','').count('{') == 0
        assert set(card['tags']) and set(card['tags']) <= {'clean','drinking','dirty'}
        assert not card['requiresAdult'] or 'dirty' in card['tags']
        assert not card['requiresDrinking'] or 'drinking' in card['tags']
        assert 'clean' not in card['tags'] or not (card['requiresAdult'] or card['requiresDrinking'])
assert not any('answer' in c and 'options' in c for c in cards), 'Reassess whether party content now includes quiz questions'
raw = (root / 'gameJson/quiz/quick-quiz-v1.json').read_bytes()
pack = json.loads(raw)
assert (pack['id'], pack['version'], pack['rulesVersion']) == ('quick_quiz', 1, 1)
assert len(pack['questions']) == 10
for i, q in enumerate(pack['questions'], 1):
    assert q['id'] == f'qq_{i:03d}'
    assert len(q['options']) == len(set(q['options'])) == 4
    assert isinstance(q['answer'], int) and q['answer'] in range(4)
    assert 1 <= len(q['text']) <= 250 and all(1 <= len(s) <= 100 for s in q['options'])
print(f'PASS: {len(cards)} party cards in {len(games)} games (not quiz content); 10 quiz questions; pack SHA-256 {hashlib.sha256(raw).hexdigest()}')
