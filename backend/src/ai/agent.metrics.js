const totals={
  requests:0,errors:0,durationMs:0,modelDurationMs:0,toolCalls:0,toolDurationMs:0,
  dbQueries:0,dbQueryMs:0,inputTokens:0,outputTokens:0,responseBytes:0,requestBytes:0,
  fallbackCount:0,toolDefinitionsCount:0,knowledgeChunks:0,attachments:0,
};

export function recordAiMetrics(sample={}){
  totals.requests+=1;totals.errors+=sample.error?1:0;
  totals.durationMs+=Number(sample.durationMs||0);totals.modelDurationMs+=Number(sample.modelDurationMs||0);
  totals.toolCalls+=Number(sample.toolCalls||0);totals.toolDurationMs+=Number(sample.toolDurationMs||0);
  totals.dbQueries+=Number(sample.dbQueries||0);totals.dbQueryMs+=Number(sample.dbQueryMs||0);
  totals.inputTokens+=Number(sample.inputTokens||0);totals.outputTokens+=Number(sample.outputTokens||0);
  totals.responseBytes+=Number(sample.responseBytes||0);totals.requestBytes+=Number(sample.requestBytes||0);
  totals.fallbackCount+=Number(sample.fallbackCount||0);totals.toolDefinitionsCount+=Number(sample.toolDefinitionsCount||0);
  totals.knowledgeChunks+=Number(sample.knowledgeChunks||0);totals.attachments+=Number(sample.attachments||0);
}

export function aiMetricsSnapshot(){return{...totals};}
export function resetAiMetricsForTests(){for(const key of Object.keys(totals))totals[key]=0;}
