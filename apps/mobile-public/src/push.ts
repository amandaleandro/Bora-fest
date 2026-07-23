import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Pede permissão e devolve o Expo push token deste aparelho, ou `null` se
 * não deu (emulador/simulador sem suporte, permissão negada). Não exige
 * conta — quem chama associa o token a um PEDIDO (`api.registerPushToken`),
 * não a um usuário, porque a compra pode ser feita sem login.
 */
export async function registerForPushNotificationsAsync(): Promise<
  { token: string; platform: "ios" | "android" } | null
> {
  if (!Device.isDevice) {
    return null; // emulador/simulador não recebe push de verdade
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  return { token, platform: Platform.OS === "ios" ? "ios" : "android" };
}
