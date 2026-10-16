#!/usr/bin/env node
'use strict';
require('../bench/run.cjs').main().catch(error=>{console.error(error.message);process.exitCode=1;});
