using System.Collections.Generic;
using Abilities.Hero;
using Components.Entity;
using UnityEngine;
using Services.EventBus;

namespace Core.Entities
{
    public class Hero : Entity
    {
        [SerializeField] private int damage;
        [SerializeField] private int energy;

        [SerializeReference, SubclassSelector]
        private List<BaseAbility> abilities = new();

        public List<BaseAbility> Abilities => abilities;
        
        public Damage Damage { get; private set; }

        public Energy Energy { get; private set; }

        private void OnDisable()
        {
            _unsubscribeOnEvents();
        }

        public override void Init()
        {
            base.Init();

            Damage = new Damage(damage);
            Energy = new Energy(energy, energy);

            foreach (var ability in abilities)
            {
                ability.Init(this);
            }

            _subscribeOnEvents();
        }

        private void _subscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, _turnStart);
        }
        
        private void _unsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, _turnStart);
        }

        private void _turnStart()
        {
            Energy.Increase();
        }
    }
}