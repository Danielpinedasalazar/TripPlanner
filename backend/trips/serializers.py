from rest_framework import serializers


class TripPlanRequestSerializer(serializers.Serializer):
    current_location = serializers.CharField(max_length=200)
    pickup_location = serializers.CharField(max_length=200)
    dropoff_location = serializers.CharField(max_length=200)
    current_cycle_used = serializers.FloatField(min_value=0, max_value=70)

    # Optional — when the driver actually begins the trip. If omitted the
    # engine falls back to today at 06:00 (legacy behavior).
    start_datetime = serializers.DateTimeField(required=False, allow_null=True)

    # Optional driver / vehicle metadata — used only for log sheet header display
    driver_name = serializers.CharField(max_length=100, required=False, default="", allow_blank=True)
    carrier_name = serializers.CharField(max_length=200, required=False, default="", allow_blank=True)
    main_office_address = serializers.CharField(max_length=300, required=False, default="", allow_blank=True)
    vehicle_numbers = serializers.CharField(max_length=100, required=False, default="", allow_blank=True)
    shipping_number = serializers.CharField(max_length=100, required=False, default="", allow_blank=True)
    co_driver_name = serializers.CharField(max_length=100, required=False, default="", allow_blank=True)
