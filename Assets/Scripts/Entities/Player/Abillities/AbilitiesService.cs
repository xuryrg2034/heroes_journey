using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    public class AbilitiesService
    {
        readonly Hero _owner;
        
        public AbilitiesService(Hero hero)
        {
            _owner = hero;
        }
        
        public List<BaseAbility> Abilities => _owner.Abilities;
        
        public BaseAbility SelectedAbility => _owner.SelectedAbility;
        
        public void SelectAbility(BaseAbility ability)
        {
            if (_owner.Energy.Value < ability.EnergyCost) return;

            DeselectAbility();
            _owner.SelectAbility(ability);
        }

        public void DeselectAbility()
        {
            _owner.DeselectAbility();
        }

        public async UniTask Execute()
        {
            await SelectedAbility.Execute();
        }
    }
}