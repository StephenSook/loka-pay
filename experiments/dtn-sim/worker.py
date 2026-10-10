"""One isolated model case, used by the optional parallel runner."""
import json
import sys
from run import evaluate

if __name__ == '__main__':
    print(json.dumps(evaluate(json.loads(sys.argv[1])), sort_keys=True))
