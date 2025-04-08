using TMPro;
using UnityEngine;

namespace Entities.Player
{
    public class HeroUIService : MonoBehaviour
    {
        [Header("UI Elements")]
        [SerializeField] EnergyUI energy;
        [SerializeField] HealthUI health;
        
        Hero _hero;

        public void Init(Hero hero)
        {
            _hero = hero;

            energy.Initialize(_hero.Energy);
            health.Initialize(_hero.Health);
        }
    }
}