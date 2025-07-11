export function getCLCheckerUDTFSrc(schema: string, version: number) {
    return `CREATE or REPLACE FUNCTION ${schema}.QCAPCMD (
                                  CMD    VARCHAR(32700),
        -- Default is regular Command entry CL syntax checking
                                  CHECKOPT  VARCHAR(14) DEFAULT '*CL'
                                          )
              returns table (
                  msgid   varchar(7),
                  msgtext varchar(1024),
                  cmdstring varchar(6000)
              )
     LANGUAGE C++
     NO SQL
     NOT DETERMINISTIC
     NOT FENCED
     SCRATCHPAD 128
     SPECIFIC COZ_CAPCMD
     EXTERNAL NAME '${schema}/COZ_CAPCMD'
     PARAMETER STYLE DB2SQL;



LABEL on specific routine ${schema}.COZ_CAPCMD IS
'Run CL command using QCAPCMD API: CONTAINS SQL';

comment on specific FUNCTION ${schema}.COZ_CAPCMD is
'Run a CL command using the QCAPCMD API.
This Function uses QCAPCMD instead of QCMDEXC so that it can be used to
run, syntax-check, restricted users with *LIMIT capabilities.';

comment on parameter specific function ${schema}.COZ_CAPCMD
(
CMD is 'The CL command to be checked. A command length of up to 32702
  bytes is supported by this function',

CHECKOPT IS 'The command processing option(s). Use this parameter
to control what kind of syntax checking is performed by this function.
The valid choices are:<ul>
 <li>*CL - Syntax check the command for Command Entry syntax.</li>
 <li>*CLLE or *ILE - Syntax check an ILE CL program command</li>
 <li>*CLP - Syntax check an OPM CL program command</li>
 <li>*PDM - Syntax check with user-defined PDM substitution options.</li>
 <li>*BINDER or *BND - Syntax check a binder language command</li>
  <li>*CMD - Syntax check *CMD statements (e.g., PARM, ELEM, QUAL, etc)</li>
 <li>*LIMIT - Syntax check regular CL as limited user command.</li>
</ul>'
);`;

}
