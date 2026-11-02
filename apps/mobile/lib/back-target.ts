/**
 * Where Android's Back goes on the guest welcome (app/welcome.tsx). With the save sheet up it is the sheet's, which
 * closes itself, whichever listener Android asks first: after a sign-in attempt from the sheet the welcome's listener is
 * registered again and asked first (#212's review). Otherwise the page steps back while it can, and from the first step
 * Back leaves as usual.
 */
export function welcomeBack({ sheet, canGoBack }: { sheet: boolean; canGoBack: boolean }): "sheet" | "step" | "leave" {
  if (sheet) return "sheet";
  return canGoBack ? "step" : "leave";
}
