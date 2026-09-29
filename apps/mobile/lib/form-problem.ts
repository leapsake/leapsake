import { Alert } from "react-native";

const CANT_SAVE = "Can’t save yet";

/** Tells the user why the form cannot be saved yet, in one swappable place. */
export function showFormProblem(message: string): void {
  Alert.alert(CANT_SAVE, message);
}
