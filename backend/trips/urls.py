from django.urls import path
from .views import TripPlanView, PlaceAutocompleteView

urlpatterns = [
    path("trip/plan/", TripPlanView.as_view(), name="trip-plan"),
    path("places/autocomplete/", PlaceAutocompleteView.as_view(), name="places-autocomplete"),
]
