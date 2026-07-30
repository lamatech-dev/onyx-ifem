# Contract fixture validation

The fixtures and executable Python test are restored from the supplied IFEM v2.0 artifact package and updated for the repository's versioned contract path.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r validation/requirements.txt
npm run test:contracts:python
```

`reports/validation-report.json` records the latest complete local verification. The original supplied hashes and package README remain under `contracts/v2.0` for provenance.
