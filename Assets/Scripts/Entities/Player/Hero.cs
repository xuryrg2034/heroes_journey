using System.Collections.Generic;
using Entities.Components;
using UnityEngine;
using Services.EventBus;

namespace Entities.Player
{
    public class Hero : BaseEntity
    {
        [SerializeField] private int damage;
        [SerializeField] private int energy;
        [SerializeField] private Animator animator;
        [SerializeReference, SubclassSelector]
        private List<BaseAbility> abilities = new();

        public Animator Animator => animator;

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
        
        private void _restoreEnergy(int value = 1)
        {
            Energy.Increase(value);
        }

        private void _subscribeOnEvents()
        {
            EventBusService.Subscribe(Actions.PlayerTurnStart, _turnStart);
            EventBusService.Subscribe<int>(Actions.PlayerRestoreEnergy, _restoreEnergy);
        }
        
        private void _unsubscribeOnEvents()
        {
            EventBusService.Unsubscribe(Actions.PlayerTurnStart, _turnStart);
            EventBusService.Unsubscribe<int>(Actions.PlayerRestoreEnergy, _restoreEnergy);
        }

        private void _turnStart()
        {
            Energy.Increase();
        }
    }
}