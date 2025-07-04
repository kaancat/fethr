# Fethr Codebase Cleanup Master File

## Overview
This file manages the cleanup agents (Supagents) that analyze the Fethr codebase to identify and remove unused, unnecessary, or bloated files/folders. Each agent has a specific domain to prevent conflicts.

## Cleanup Agents

### Agent 1: Python Artifacts Agent
**Domain**: Python-related files and folders
**Status**: READY TO ANALYZE
**Findings**:
- `/src-tauri/resources/simple_whisper_solution.py` - Standalone Python Whisper implementation
  - **Analysis**: Not referenced in Rust code, app uses whisper.cpp instead
  - **Recommendation**: DELETE - Alternative implementation not in use
- No Python dependencies in Cargo.toml
- No Python imports in main codebase

### Agent 2: Build Artifacts Agent
**Domain**: Build outputs, caches, temporary files
**Status**: PENDING
**Targets**:
- `target/` folders (Rust build artifacts)
- `node_modules/` (can be reinstalled)
- `.next/` cache
- `dist/` folders
- `*.log` files
- Temporary test outputs

### Agent 3: Documentation Cleanup Agent
**Domain**: Outdated or redundant documentation
**Status**: PENDING
**Targets**:
- Old TODO files
- Duplicate documentation
- Test/example files that are no longer relevant
- Old design documents

### Agent 4: Asset Optimization Agent
**Domain**: Images, icons, media files
**Status**: PENDING
**Targets**:
- Unused images in public/assets
- Duplicate icons
- Old branding materials
- Uncompressed media files

### Agent 5: Dead Code Agent
**Domain**: Unused source code files
**Status**: PENDING
**Targets**:
- Commented out imports
- Unused React components
- Deprecated API endpoints
- Old migration files

### Agent 6: Configuration Cleanup Agent
**Domain**: Config files and settings
**Status**: PENDING
**Targets**:
- Duplicate config files
- Old environment examples
- Unused package.json scripts
- Deprecated settings

## Conflict Prevention Rules

1. **No Cross-Domain Actions**: Each agent only touches files in their domain
2. **Dependency Check**: Before deleting, verify no imports/references exist
3. **Git Check**: Only delete files that are committed (no uncommitted work lost)
4. **Backup List**: Create a deletion manifest before executing
5. **Incremental Deletion**: Delete in small batches with verification

## Safe Files/Folders (DO NOT DELETE)

### Core Application Files
- `/src/` - Frontend source code
- `/src-tauri/src/` - Rust backend code
- `/public/` - Static assets (verify individually)
- `package.json`, `Cargo.toml` - Core dependency files
- `.env.local`, `.env` - Environment configuration
- `CLAUDE.md` - Project instructions

### Essential Config
- `tauri.conf.json` - Tauri configuration
- `tsconfig.json` - TypeScript config
- `next.config.js` - Next.js config
- `.gitignore` - Git ignore rules
- `vercel.json` - Vercel deployment config

### Current Work
- `/tasks/todo.md` - Active task tracking
- Recent test files (check dates)
- Active feature branches

## Execution Plan

### Phase 1: Analysis (Current)
1. Each agent analyzes their domain
2. Create detailed report of findings
3. Mark confidence level (HIGH/MEDIUM/LOW)

### Phase 2: Review
1. Present findings for user approval
2. Group by confidence level
3. Allow selective approval

### Phase 3: Cleanup
1. Create backup manifest
2. Execute approved deletions
3. Verify application still works
4. Commit changes

## Agent Analysis Commands

### Python Artifacts Agent
```bash
# Find all Python files
find . -name "*.py" -type f 2>/dev/null | grep -v node_modules | grep -v target

# Check for Python imports in Rust
rg "python|\.py" src-tauri/src --type rust

# Check for Python references in package.json
grep -i python package.json
```

### Build Artifacts Agent
```bash
# Find build directories
find . -type d -name "target" -o -name "dist" -o -name ".next" 2>/dev/null

# Find log files
find . -name "*.log" -type f 2>/dev/null

# Check .gitignore for already ignored paths
cat .gitignore
```

### Documentation Cleanup Agent
```bash
# Find all markdown files
find . -name "*.md" -type f | grep -v node_modules | grep -v target

# Find TODO files
find . -iname "*todo*" -type f

# Find old test files
find . -name "*test*" -o -name "*example*" -type f | grep -v node_modules
```

## Current Status

### Immediate Recommendations
1. **DELETE**: `/src-tauri/resources/simple_whisper_solution.py`
   - Confidence: HIGH
   - Reason: Alternative Python implementation not used, app uses whisper.cpp
   
2. **INVESTIGATE**: Python folder mentioned in startup logs
   - Need to locate and analyze

3. **PRESERVE**: All filler removal work (recently completed feature)

## Next Steps
1. Run comprehensive analysis for each agent
2. Identify Python folder location
3. Check for unused npm packages
4. Scan for large files that could be optimized

---
Last Updated: [Current Session]
Status: ACTIVE ANALYSIS