export interface ViewportConfig {
  width: number;
  height: number;
  name: string;
}

export interface CliOptions {
  baseUrl: string;
  chromiumPath?: string | undefined;
  debugPort: number;
  timeoutMs: number;
  verbose: boolean;
}

export type CheckStatus = "PASS" | "FAIL" | "BLOCKED";

export interface ViewportResult {
  route: string;
  viewport: ViewportConfig;
  status: "PASS" | "FAIL";
  innerWidth: number;
  scrollWidth: number;
  hasHorizontalOverflow: boolean;
  clippedControls: string[];
  details?: string | undefined;
}

export interface ActiveElementFocusInfo {
  tag: string;
  id: string;
  text?: string | undefined;
  disabled?: boolean | undefined;
  matchesFocusVisible?: boolean | undefined;
  outlineStyle?: string | undefined;
  outlineWidth?: string | undefined;
  boxShadow?: string | undefined;
  borderColor?: string | undefined;
}

export interface TabStepResult {
  step: number;
  expectedControl: string;
  actualId: string;
  actualText: string;
  actualTag: string;
  matchesExpected: boolean;
  hasObservableFocus: boolean;
  failureReason?: string | undefined;
}

export interface FocusExitResult {
  success: boolean;
  activeTag?: string | undefined;
  activeId?: string | undefined;
  activeText?: string | undefined;
  isInsideContainer: boolean;
  skippedDisabledButton: boolean;
  failureReason?: string | undefined;
}

export interface AriaAssociationCheck {
  fieldId: string;
  hasAriaInvalid: boolean;
  ariaDescribedBy: string | null;
  targetElementsExist: boolean;
  missingTargets?: string[] | undefined;
}

export interface ActionButtonCheck {
  label: string;
  disabled: boolean;
  prerequisitePresent: boolean;
  prerequisiteText?: string | undefined;
}

export interface PresetChipCheck {
  label: string;
  ariaPressed: string | null;
}

export interface RouteAccessibilityResult {
  route: string;
  status: "PASS" | "FAIL";
  navigationValid: boolean;
  tabSequenceValid: boolean;
  focusExitValid: boolean;
  visibleFocusValid: boolean;
  ariaAssociationsValid: boolean;
  disabledActionValid: boolean;
  presetChipsValid?: boolean | undefined;
  tabSteps: TabStepResult[];
  focusExitResult?: FocusExitResult | undefined;
  ariaChecks: AriaAssociationCheck[];
  actionChecks: ActionButtonCheck[];
  presetChecks?: PresetChipCheck[] | undefined;
  failures: string[];
}

export interface SmokeSummary {
  overallStatus: CheckStatus;
  baseUrl: string;
  chromiumPath?: string | undefined;
  blockedReason?: string | undefined;
  viewportResults: ViewportResult[];
  routeAccessibilityResults: RouteAccessibilityResult[];
  failures: string[];
}
