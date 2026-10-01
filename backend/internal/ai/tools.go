package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// AutoClaimToolSchema is the shared JSON Schema for auto claim extraction.
// Used identically by every provider adapter.
func AutoClaimToolSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"policyNumber": map[string]interface{}{
				"type":        "string",
				"description": "Insurance policy number exactly as the customer wrote it.",
			},
			"insuredFullName": map[string]interface{}{
				"type":        "string",
				"description": "Complete full name of the insured person (first name + last name).",
			},
			"phoneNumber": map[string]interface{}{
				"type":        "string",
				"description": "Primary phone number of the insured person. Extract digits only.",
			},
			"address": map[string]interface{}{
				"type":        "string",
				"description": "Complete residential address of the insured person.",
			},
			"email": map[string]interface{}{
				"type":        "string",
				"description": "Email address of the insured person (optional).",
			},
			"birthDate": map[string]interface{}{
				"type":        "string",
				"description": "Date of birth in YYYY-MM-DD format.",
			},
			"licenseNumber": map[string]interface{}{
				"type":        "string",
				"description": "Driver's license number.",
			},
			"vehicleMakeModel": map[string]interface{}{
				"type":        "string",
				"description": "Vehicle manufacturer and model name.",
			},
			"vehicleYear": map[string]interface{}{
				"type":        "integer",
				"description": "Year of vehicle manufacture as integer.",
			},
			"vehicleRegistration": map[string]interface{}{
				"type":        "string",
				"description": "Vehicle registration / license plate.",
			},
			"vehicleVin": map[string]interface{}{
				"type":        "string",
				"description": "Vehicle Identification Number (VIN).",
			},
			"incidentDate": map[string]interface{}{
				"type":        "string",
				"description": "Date when the accident occurred in YYYY-MM-DD format.",
			},
			"incidentTime": map[string]interface{}{
				"type":        "string",
				"description": "Time of incident in HH:MM 24-hour format.",
			},
			"incidentLocation": map[string]interface{}{
				"type":        "string",
				"description": "Precise location where the accident occurred.",
			},
			"roadType": map[string]interface{}{
				"type":        "string",
				"description": "Type of road where incident occurred.",
			},
			"otherDriverName": map[string]interface{}{
				"type":        "string",
				"description": "Full name of the other driver.",
			},
			"otherDriverPhone": map[string]interface{}{
				"type":        "string",
				"description": "Phone number of the other driver.",
			},
			"otherInsuranceCompany": map[string]interface{}{
				"type":        "string",
				"description": "Insurance company of the other party.",
			},
			"otherPolicyNumber": map[string]interface{}{
				"type":        "string",
				"description": "Policy number of the other party.",
			},
			"otherVehicleRegistration": map[string]interface{}{
				"type":        "string",
				"description": "Registration of the other vehicle.",
			},
			"incidentDescription": map[string]interface{}{
				"type":        "string",
				"description": "Detailed description of what happened.",
			},
			"damageDescription": map[string]interface{}{
				"type":        "string",
				"description": "Description of damage to the insured vehicle.",
			},
			"estimatedDamage": map[string]interface{}{
				"type":        "string",
				"description": "Estimated damage amount if mentioned.",
			},
			"policeContacted": map[string]interface{}{
				"type":        "string",
				"description": "Whether police were contacted. Return 'true' or 'false' as string.",
			},
			"policeReportNumber": map[string]interface{}{
				"type":        "string",
				"description": "Police report number if available.",
			},
			"injuriesOccurred": map[string]interface{}{
				"type":        "string",
				"description": "Whether injuries occurred. Return 'true' or 'false' as string.",
			},
			"injuryDescription": map[string]interface{}{
				"type":        "string",
				"description": "Description of injuries if any.",
			},
			"medicalTreatmentRequired": map[string]interface{}{
				"type":        "string",
				"description": "Whether medical treatment was required. Return 'true' or 'false' as string.",
			},
			"additionalNotes": map[string]interface{}{
				"type":        "string",
				"description": "Any additional relevant information.",
			},
		},
		"required": []string{"insuredFullName", "phoneNumber"},
	}
}

// ExtractAutoClaimDataTool returns the standard claim extraction tool definition.
func ExtractAutoClaimDataTool() ToolDefinition {
	return ToolDefinition{
		Name: "extract_auto_claim_data",
		Description: `Extract and structure auto insurance claim data from natural language input. ` +
			`Processes French or English text and outputs structured JSON for creating an insurance claim record.`,
		Parameters: AutoClaimToolSchema(),
	}
}

// ExtractToolArguments normalizes native calls and JSON-in-text responses. It
// performs exactly one prompt-based repair when a model lacks tool support or
// returns malformed JSON. This deliberately does not rely on vendor-specific
// JSON-mode flags, which are inconsistently supported by compatible endpoints.
func ExtractToolArguments(ctx context.Context, provider LLMProvider, req CompletionRequest, tool ToolDefinition) (map[string]interface{}, error) {
	args, _, err := ExtractToolArgumentsWithMode(ctx, provider, req, tool)
	return args, err
}

// Extraction modes reported by ExtractToolArgumentsWithMode.
const (
	ExtractionModeToolCall = "native_tool_call"
	ExtractionModeJSONText = "json_text_fallback"
	ExtractionModeRepair   = "repair"
)

// ExtractToolArgumentsWithMode is ExtractToolArguments and also reports how the
// arguments were obtained: a native tool call, JSON in the text reply, or the
// one repair round-trip. Callers log it to monitor model behaviour.
func ExtractToolArgumentsWithMode(ctx context.Context, provider LLMProvider, req CompletionRequest, tool ToolDefinition) (map[string]interface{}, string, error) {
	if provider == nil {
		return nil, "", fmt.Errorf("no LLM provider")
	}
	if len(req.Tools) == 0 {
		req.Tools = []ToolDefinition{tool}
	}
	resp, err := provider.Complete(ctx, req)
	if err != nil {
		return nil, "", err
	}
	if args, mode, ok := toolArgsFromResponse(resp, tool, ExtractionModeToolCall, ExtractionModeJSONText); ok {
		return args, mode, nil
	}
	repair := repairRequest(req, tool, resp)
	fixed, err := provider.Complete(ctx, repair)
	if err != nil {
		return nil, ExtractionModeRepair, fmt.Errorf("claim extraction repair failed: %w", err)
	}
	if args, _, ok := toolArgsFromResponse(fixed, tool, ExtractionModeRepair, ExtractionModeRepair); ok {
		return args, ExtractionModeRepair, nil
	}
	return nil, ExtractionModeRepair, fmt.Errorf("claim extraction did not return valid JSON matching required fields")
}

// repairRequest asks once more for the arguments as plain JSON. It keeps the
// original system prompt, conversation and prompt: without them the model
// has nothing to extract from and can only return empty fields.
func repairRequest(req CompletionRequest, tool ToolDefinition, previous *CompletionResponse) CompletionRequest {
	instruction := "Return ONLY a valid JSON object with the arguments for " + tool.Name +
		", based on the information above. Use this JSON schema and no markdown: " + mustJSON(tool.Parameters)
	if prev := strings.TrimSpace(responseText(previous)); prev != "" {
		instruction += "\nYour previous reply was not valid: " + prev
	}
	prompt := instruction
	if p := strings.TrimSpace(req.Prompt); p != "" {
		prompt = p + "\n\n" + instruction
	}
	return CompletionRequest{
		SystemPrompt: req.SystemPrompt,
		Messages:     req.Messages,
		Prompt:       prompt,
		Temperature:  0.1,
		MaxTokens:    req.MaxTokens,
	}
}

func toolArgsFromResponse(resp *CompletionResponse, tool ToolDefinition, callMode, textMode string) (map[string]interface{}, string, bool) {
	if resp == nil {
		return nil, "", false
	}
	for _, call := range resp.ToolCalls {
		if call.Name == tool.Name && validToolArgs(call.Arguments, tool.Parameters) {
			return call.Arguments, callMode, true
		}
	}
	if args, err := jsonObject(resp.Text); err == nil && validToolArgs(args, tool.Parameters) {
		return args, textMode, true
	}
	return nil, "", false
}

func responseText(resp *CompletionResponse) string {
	if resp == nil {
		return ""
	}
	return resp.Text
}
func mustJSON(v interface{}) string { b, _ := json.Marshal(v); return string(b) }
func jsonObject(text string) (map[string]interface{}, error) {
	text = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(text, "```"), "```json"))
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end < start {
		return nil, fmt.Errorf("no JSON object")
	}
	var out map[string]interface{}
	err := json.Unmarshal([]byte(text[start:end+1]), &out)
	return out, err
}
func validToolArgs(args map[string]interface{}, schema map[string]interface{}) bool {
	if len(args) == 0 {
		return false
	}
	required, _ := schema["required"].([]string)
	if required == nil {
		if xs, ok := schema["required"].([]interface{}); ok {
			for _, x := range xs {
				if s, ok := x.(string); ok {
					required = append(required, s)
				}
			}
		}
	}
	for _, key := range required {
		if v, ok := args[key]; !ok || strings.TrimSpace(fmt.Sprint(v)) == "" {
			return false
		}
	}
	return true
}
