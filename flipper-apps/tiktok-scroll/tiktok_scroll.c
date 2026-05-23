#include <furi.h>
#include <furi_hal.h>
#include <gui/gui.h>
#include <input/input.h>
#include <notification/notification.h>
#include <notification/notification_messages.h>
#include <bt/bt_service/bt.h>
#include <furi_hal_bt_hid.h>

// USB HID keyboard usage codes
#define HID_KEYBOARD_UP_ARROW    0x52
#define HID_KEYBOARD_DOWN_ARROW  0x51
#define HID_KEYBOARD_SPACE       0x2C
#define HID_KEYBOARD_L           0x0F  // 'L' — like shortcut on TikTok web/desktop

// Key-press duration in ms
#define HID_PRESS_DELAY_MS 30

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* event_queue;
    Bt* bt;
    bool bt_connected;
} TikTokScrollApp;

static void draw_callback(Canvas* canvas, void* ctx) {
    TikTokScrollApp* app = ctx;
    furi_assert(app);

    canvas_clear(canvas);

    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str_aligned(canvas, 64, 0, AlignCenter, AlignTop, "TikTok Scroll");

    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str_aligned(
        canvas,
        64,
        13,
        AlignCenter,
        AlignTop,
        app->bt_connected ? "BT Connected" : "Waiting for BT pair...");

    // Divider
    canvas_draw_line(canvas, 0, 23, 127, 23);

    canvas_draw_str(canvas, 2, 33, "\x14  Prev video");
    canvas_draw_str(canvas, 2, 43, "\x15  Next video");
    canvas_draw_str(canvas, 2, 53, "OK  Pause / Play");
    canvas_draw_str(canvas, 2, 63, "\x13  Like  |  BACK  Exit");
}

static void input_callback(InputEvent* input_event, void* ctx) {
    FuriMessageQueue* queue = ctx;
    furi_message_queue_put(queue, input_event, FuriWaitForever);
}

static void bt_status_callback(BtStatus status, void* ctx) {
    TikTokScrollApp* app = ctx;
    app->bt_connected = (status == BtStatusConnected);
    view_port_update(app->view_port);
}

static void send_key(uint8_t keycode, NotificationApp* notif, const NotificationSequence* seq) {
    furi_hal_bt_hid_kb_press(0, keycode);
    furi_delay_ms(HID_PRESS_DELAY_MS);
    furi_hal_bt_hid_kb_release_all();
    notification_message(notif, seq);
}

int32_t tiktok_scroll_app(void* p) {
    UNUSED(p);

    TikTokScrollApp* app = malloc(sizeof(TikTokScrollApp));
    memset(app, 0, sizeof(TikTokScrollApp));

    app->event_queue = furi_message_queue_alloc(8, sizeof(InputEvent));

    app->view_port = view_port_alloc();
    view_port_draw_callback_set(app->view_port, draw_callback, app);
    view_port_input_callback_set(app->view_port, input_callback, app->event_queue);

    app->gui = furi_record_open(RECORD_GUI);
    gui_add_view_port(app->gui, app->view_port, GuiLayerFullscreen);

    // Switch BT to HID keyboard profile; restores on exit
    app->bt = furi_record_open(RECORD_BT);
    bt_set_status_changed_callback(app->bt, bt_status_callback, app);
    bt_set_profile(app->bt, BtProfileHidKeyboard);

    NotificationApp* notif = furi_record_open(RECORD_NOTIFICATION);

    InputEvent event;
    bool running = true;

    while(running) {
        if(furi_message_queue_get(app->event_queue, &event, 200) != FuriStatusOk) {
            continue;
        }

        // Accept both short press and repeat (hold) for scroll keys
        bool is_press = (event.type == InputTypeShort || event.type == InputTypeRepeat);

        if(is_press) {
            switch(event.key) {
            case InputKeyUp:
                send_key(HID_KEYBOARD_UP_ARROW, notif, &sequence_blink_blue_10);
                break;

            case InputKeyDown:
                send_key(HID_KEYBOARD_DOWN_ARROW, notif, &sequence_blink_blue_10);
                break;

            case InputKeyOk:
                if(event.type == InputTypeShort) {
                    send_key(HID_KEYBOARD_SPACE, notif, &sequence_blink_green_10);
                }
                break;

            case InputKeyLeft:
                // 'L' key — like the current video (TikTok web / desktop shortcut)
                if(event.type == InputTypeShort) {
                    send_key(HID_KEYBOARD_L, notif, &sequence_blink_magenta_10);
                }
                break;

            case InputKeyBack:
                running = false;
                break;

            default:
                break;
            }
        } else if(event.type == InputTypeLong && event.key == InputKeyBack) {
            running = false;
        }
    }

    // Restore serial BT profile before exiting
    bt_set_status_changed_callback(app->bt, NULL, NULL);
    bt_set_profile(app->bt, BtProfileSerial);

    furi_record_close(RECORD_NOTIFICATION);
    furi_record_close(RECORD_BT);
    gui_remove_view_port(app->gui, app->view_port);
    furi_record_close(RECORD_GUI);
    view_port_free(app->view_port);
    furi_message_queue_free(app->event_queue);
    free(app);

    return 0;
}
