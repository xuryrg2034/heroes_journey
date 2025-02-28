using System;
using Core.Entities;
using Services.Grid;
using TMPro;
using UnityEngine;
using UnityEngine.Serialization;
using UnityEngine.UI;

namespace Services.UI
{
    public class HeroUIService : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] private TextMeshProUGUI power;
        [SerializeField] private TextMeshProUGUI energy;
        [SerializeField] private TextMeshProUGUI health;
        
        private Hero _hero;

        public void Init(Hero hero)
        {
            _hero = hero;
            
            _updatePower(_hero.Damage.Value);
            _updateEnergy(_hero.Energy.Value);
            _updateHealth(_hero.Health.Value);

            _hero.Energy.OnValueChanged.AddListener(_updateEnergy);
            _hero.Damage.OnValueChanged.AddListener(_updatePower);
            _hero.Health.OnValueChanged.AddListener(_updateHealth);
        }

        private void _updatePower(int value)
        {
            power.text = $"Power: {value}";
        }
        
        private void _updateHealth(int value)
        {
            health.text = $"Health: {value}";
        }
        
        private void _updateEnergy(int value)
        {
            energy.text = $"Energy: {value}";
        }

        // private void _showPower(int value)
        // {
        //     heroPower.text = $"Power: {value}";
        // }
    }
}