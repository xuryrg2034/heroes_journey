using System;
using Entities.Components;
using TMPro;
using UnityEngine;
namespace Entities.Player
{
    public class EnergyUI : MonoBehaviour
    {
        [SerializeField] TextMeshProUGUI text;
        
        Energy _energy;

        int MaxValue => _energy.MaxEnergy;
        
        int CurrentValue => _energy.Value;
        
        int Reserved => _energy.Reserved;
        
        public void Initialize(Energy energy)
        {
           _energy = energy;

           InitText();

           _energy.OnReservedChanged.AddListener(UpdateReserved);
           _energy.OnValueChanged.AddListener(UpdateCurrentEnergy);
        }

        void InitText()
        {
            text.text = $"Energy : {CurrentValue}/{MaxValue}";
        }
        
        void UpdateReserved(int value)
        {
            text.text = $"Energy : {CurrentValue - value}/{MaxValue}";
        }

        void UpdateCurrentEnergy(int value)
        {
            text.text = $"Energy : {value}/{MaxValue}";
        }
    }
}
