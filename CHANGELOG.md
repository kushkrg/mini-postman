# Changelog

All notable changes to Mini Postman are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-11-05

### Added
- **Environments**: variables now live in named environments (e.g. Local, Staging, Production), switchable from the top bar. Create, rename and delete environments from the Variables dialog.
- Collection exports now include all environments; older exports still import (their variables land in the active environment).

### Changed
- Existing users' variables migrate automatically into a "Default" environment — nothing is lost on upgrade.

## [1.0.0] - 2026-10-25

### Added
- First release: request engine (all HTTP methods, params, headers, JSON/text/form bodies), Bearer/Basic/API-key auth, variables with {{name}} substitution, saved requests, history (last 50), a live cURL generator, and a zero-dependency Python backend.
